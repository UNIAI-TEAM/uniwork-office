import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: { sender: FakeWebContents }, ...args: unknown[]) => unknown

interface FakeWebContents {
  id: number
  listeners: Map<string, () => void>
  isDestroyed: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
}

const handlers = new Map<string, IpcHandler>()
const showMessageBox = vi.fn()
const showSaveDialogWithMemory = vi.fn()
const webContents: FakeWebContents[] = []
let nextWebContentsId = 1

function makeWebContents(): FakeWebContents {
  const listeners = new Map<string, () => void>()
  const contents: FakeWebContents = {
    id: nextWebContentsId++,
    listeners,
    isDestroyed: vi.fn(() => false),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    loadURL: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  }
  webContents.push(contents)
  return contents
}

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpdir()),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => {})),
  },
  BrowserWindow: class {
    static fromWebContents() {
      return null
    }
    static getFocusedWindow() {
      return null
    }
  },
  dialog: {
    showMessageBox: (...args: unknown[]) => showMessageBox(...args),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    removeHandler: vi.fn(),
  },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  WebContentsView: class {
    webContents = makeWebContents()
  },
}))

vi.mock('@genoffice/electron-utils', () => ({
  configuredDefaultSaveDir: vi.fn(() => tmpdir()),
  contextMenuLabels: vi.fn(() => ({})),
  installContextMenu: vi.fn(),
  installNavigationGuard: vi.fn(),
  rendererUrl: vi.fn(() => 'genoffice-app://markdown/index.html'),
  safeExternalUrl: vi.fn(() => null),
  showOpenDialogWithMemory: vi.fn(),
  showSaveDialogWithMemory: (...args: unknown[]) => showSaveDialogWithMemory(...args),
}))

import {
  readOwnedAssetManifest,
  reconcileOwnedAssets,
  writeImageIntoOwnedAssets,
} from '../src/main/asset-lifecycle'
import { createMarkdownView, requestMarkdownClose } from '../src/main/markdown-main'
import { MARKDOWN_CHANNELS, MAX_PASTED_IMAGE_BYTES } from '../src/shared/ipc'

const temporaryDirectories: string[] = []

async function createDocument(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'markdown-close-assets-'))
  temporaryDirectories.push(directory)
  const documentPath = join(directory, 'note.md')
  await writeFile(documentPath, '# Saved document')
  return documentPath
}

function markDirty(contents: FakeWebContents): void {
  handlers.get(MARKDOWN_CHANNELS.dirtyChanged)?.({ sender: contents }, true)
}

afterEach(async () => {
  vi.restoreAllMocks()
  showMessageBox.mockReset()
  showSaveDialogWithMemory.mockReset()
  for (const contents of webContents.splice(0)) contents.listeners.get('destroyed')?.()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('requestMarkdownClose asset cleanup', () => {
  it("deletes pending owned assets on Don't Save while preserving saved assets", async () => {
    const documentPath = await createDocument()
    const saved = await writeImageIntoOwnedAssets(
      documentPath,
      'saved.png',
      Buffer.from('saved image'),
    )
    await reconcileOwnedAssets(documentPath, [saved])
    const pending = await writeImageIntoOwnedAssets(
      documentPath,
      'pending.png',
      Buffer.from('pending image'),
    )
    const view = createMarkdownView(documentPath)
    const contents = view.webContents as unknown as FakeWebContents
    markDirty(contents)
    showMessageBox.mockResolvedValue({ response: 1 })

    await expect(requestMarkdownClose(contents as never)).resolves.toBe(true)

    expect(existsSync(join(dirname(documentPath), saved))).toBe(true)
    expect(existsSync(join(dirname(documentPath), pending))).toBe(false)
    expect(await readOwnedAssetManifest(documentPath)).toMatchObject({
      files: [{ name: 'saved.png' }],
      pending: {},
    })
  })

  it('preserves pending owned assets when close is canceled', async () => {
    const documentPath = await createDocument()
    const pending = await writeImageIntoOwnedAssets(
      documentPath,
      'pending.png',
      Buffer.from('pending image'),
    )
    const view = createMarkdownView(documentPath)
    const contents = view.webContents as unknown as FakeWebContents
    markDirty(contents)
    showMessageBox.mockResolvedValue({ response: 2 })

    await expect(requestMarkdownClose(contents as never)).resolves.toBe(false)

    expect(existsSync(join(dirname(documentPath), pending))).toBe(true)
    expect(await readOwnedAssetManifest(documentPath)).toMatchObject({
      files: [{ name: 'pending.png' }],
      pending: { 'note.md': ['pending.png'] },
    })
  })

  it('preserves referenced assets when the user successfully saves before closing', async () => {
    const documentPath = await createDocument()
    const pending = await writeImageIntoOwnedAssets(
      documentPath,
      'pending.png',
      Buffer.from('pending image'),
    )
    const view = createMarkdownView(documentPath)
    const contents = view.webContents as unknown as FakeWebContents
    markDirty(contents)
    showMessageBox.mockResolvedValue({ response: 0 })

    const closing = requestMarkdownClose(contents as never)
    await vi.waitFor(() =>
      expect(contents.send).toHaveBeenCalledWith(MARKDOWN_CHANNELS.closeSaveRequest),
    )
    const saveResult = await handlers.get(MARKDOWN_CHANNELS.save)?.(
      { sender: contents },
      {
        text: `![pending](${pending})`,
        imageSources: [pending],
        mode: 'save',
      },
    )
    handlers.get(MARKDOWN_CHANNELS.closeSaveResult)?.({ sender: contents }, true)

    await expect(closing).resolves.toBe(true)
    expect(saveResult).toMatchObject({ ok: true, path: documentPath })
    expect(existsSync(join(dirname(documentPath), pending))).toBe(true)
    expect(await readOwnedAssetManifest(documentPath)).toMatchObject({
      files: [{ name: 'pending.png' }],
      documents: { 'note.md': ['pending.png'] },
      pending: {},
    })
  })
})

describe('Save As source pending ownership', () => {
  it('clears the old document key for same-directory Save As without deleting new references', async () => {
    const sourcePath = await createDocument()
    const saved = await writeImageIntoOwnedAssets(
      sourcePath,
      'saved.png',
      Buffer.from('saved image'),
    )
    await reconcileOwnedAssets(sourcePath, [saved])
    await writeFile(sourcePath, `![saved](${saved})`)
    const pending = await writeImageIntoOwnedAssets(
      sourcePath,
      'pending.png',
      Buffer.from('pending image'),
    )
    const targetPath = join(dirname(sourcePath), 'copy.md')
    showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: targetPath })
    const view = createMarkdownView(sourcePath)
    const contents = view.webContents as unknown as FakeWebContents

    const saveResult = await handlers.get(MARKDOWN_CHANNELS.save)?.(
      { sender: contents },
      {
        text: `![saved](${saved})\n![pending](${pending})`,
        imageSources: [saved, pending],
        mode: 'saveAs',
      },
    )

    expect(saveResult).toMatchObject({ ok: true, path: targetPath })
    expect(existsSync(join(dirname(sourcePath), pending))).toBe(true)
    expect(await readFile(sourcePath, 'utf8')).toBe(`![saved](${saved})`)
    expect(await readOwnedAssetManifest(targetPath)).toMatchObject({
      files: [{ name: 'pending.png' }, { name: 'saved.png' }],
      documents: {
        'copy.md': ['pending.png', 'saved.png'],
        'note.md': ['saved.png'],
      },
      pending: {},
    })
  })

  it('removes cross-directory source orphans while preserving old saved references', async () => {
    const sourcePath = await createDocument()
    const saved = await writeImageIntoOwnedAssets(
      sourcePath,
      'saved.png',
      Buffer.from('saved image'),
    )
    await reconcileOwnedAssets(sourcePath, [saved])
    await writeFile(sourcePath, `![saved](${saved})`)
    const pending = await writeImageIntoOwnedAssets(
      sourcePath,
      'pending.png',
      Buffer.from('pending image'),
    )
    const targetDirectory = await mkdtemp(join(tmpdir(), 'markdown-save-as-target-'))
    temporaryDirectories.push(targetDirectory)
    const targetPath = join(targetDirectory, 'copy.md')
    showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: targetPath })
    const view = createMarkdownView(sourcePath)
    const contents = view.webContents as unknown as FakeWebContents

    const saveResult = await handlers.get(MARKDOWN_CHANNELS.save)?.(
      { sender: contents },
      {
        text: `![saved](${saved})\n![pending](${pending})`,
        imageSources: [saved, pending],
        mode: 'saveAs',
      },
    )

    expect(saveResult).toMatchObject({
      ok: true,
      path: targetPath,
      imageRewrites: [
        { from: saved, to: 'assets/saved.png' },
        { from: pending, to: 'assets/pending.png' },
      ],
    })
    expect(existsSync(join(dirname(sourcePath), pending))).toBe(false)
    expect(await readFile(join(dirname(sourcePath), saved), 'utf8')).toBe('saved image')
    expect(await readFile(sourcePath, 'utf8')).toBe(`![saved](${saved})`)
    expect(await readOwnedAssetManifest(sourcePath)).toMatchObject({
      files: [{ name: 'saved.png' }],
      documents: { 'note.md': ['saved.png'] },
      pending: {},
    })
    expect(await readOwnedAssetManifest(targetPath)).toMatchObject({
      files: [{ name: 'pending.png' }, { name: 'saved.png' }],
      documents: { 'copy.md': ['pending.png', 'saved.png'] },
      pending: {},
    })
  })

  it.skipIf(process.platform === 'win32')(
    'resolves source pending ownership even when destination reconciliation reports an error',
    async () => {
      const sourcePath = await createDocument()
      const keep = await writeImageIntoOwnedAssets(
        sourcePath,
        'keep.png',
        Buffer.from('keep image'),
      )
      const orphan = await writeImageIntoOwnedAssets(
        sourcePath,
        'orphan.png',
        Buffer.from('orphan image'),
      )
      // Simulate a source file that already references one still-pending asset.
      await writeFile(sourcePath, `![keep](${keep})`)

      const targetDirectory = await mkdtemp(join(tmpdir(), 'markdown-save-as-error-target-'))
      temporaryDirectories.push(targetDirectory)
      const targetPath = join(targetDirectory, 'copy.md')
      const blocked = await writeImageIntoOwnedAssets(
        targetPath,
        'blocked.png',
        Buffer.from('unrelated target asset'),
      )
      const blockedPath = join(targetDirectory, blocked)
      await chmod(blockedPath, 0)
      showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: targetPath })
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const view = createMarkdownView(sourcePath)
      const contents = view.webContents as unknown as FakeWebContents

      let saveResult: unknown
      try {
        saveResult = await handlers.get(MARKDOWN_CHANNELS.save)?.(
          { sender: contents },
          {
            text: `![keep](${keep})\n![orphan](${orphan})`,
            imageSources: [keep, orphan],
            mode: 'saveAs',
          },
        )
      } finally {
        await chmod(blockedPath, 0o600)
      }

      expect(saveResult).toMatchObject({ ok: true, path: targetPath })
      expect(warning).toHaveBeenCalledWith(
        '[markdown] asset reconciliation incomplete:',
        expect.arrayContaining([expect.stringContaining('blocked.png')]),
      )
      expect(existsSync(join(dirname(sourcePath), keep))).toBe(true)
      expect(existsSync(join(dirname(sourcePath), orphan))).toBe(false)
      expect(await readOwnedAssetManifest(sourcePath)).toMatchObject({
        files: [{ name: 'keep.png' }],
        pending: {},
      })
      expect(existsSync(join(targetDirectory, 'assets', 'keep.png'))).toBe(true)
      expect(existsSync(join(targetDirectory, 'assets', 'orphan.png'))).toBe(true)
    },
  )

  it('preserves source pending ownership and rolls back copied assets when Save As fails', async () => {
    const sourcePath = await createDocument()
    const pending = await writeImageIntoOwnedAssets(
      sourcePath,
      'pending.png',
      Buffer.from('pending image'),
    )
    const targetDirectory = await mkdtemp(join(tmpdir(), 'markdown-save-as-failure-'))
    temporaryDirectories.push(targetDirectory)
    const targetPath = join(targetDirectory, 'copy.md')
    // A directory at the picked file path makes the final atomic rename fail
    // after destination assets have already been prepared.
    await mkdir(targetPath)
    showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: targetPath })
    const view = createMarkdownView(sourcePath)
    const contents = view.webContents as unknown as FakeWebContents

    const saveResult = await handlers.get(MARKDOWN_CHANNELS.save)?.(
      { sender: contents },
      {
        text: `![pending](${pending})`,
        imageSources: [pending],
        mode: 'saveAs',
      },
    )

    expect(saveResult).toMatchObject({ ok: false })
    expect(existsSync(join(dirname(sourcePath), pending))).toBe(true)
    expect(await readOwnedAssetManifest(sourcePath)).toMatchObject({
      files: [{ name: 'pending.png' }],
      pending: { 'note.md': ['pending.png'] },
    })
    expect(existsSync(join(targetDirectory, 'assets', 'pending.png'))).toBe(false)
  })
})

describe('discarding the assets one AI run created (Roll back)', () => {
  it('removes only the named pending assets: a user-inserted one and a saved one survive', async () => {
    const documentPath = await createDocument()
    const directory = dirname(documentPath)
    const saved = await writeImageIntoOwnedAssets(
      documentPath,
      'saved.png',
      Buffer.from('saved image'),
    )
    await reconcileOwnedAssets(documentPath, [saved])
    const userInserted = await writeImageIntoOwnedAssets(
      documentPath,
      'mine.png',
      Buffer.from('user image'),
    )
    const aiMade = await writeImageIntoOwnedAssets(
      documentPath,
      'image.png',
      Buffer.from('ai image'),
    )
    const view = createMarkdownView(documentPath)
    const contents = view.webContents as unknown as FakeWebContents

    // the renderer names the run's asset, and also (wrongly or late) a saved one and a stray name
    const result = await handlers.get(MARKDOWN_CHANNELS.discardPendingAssets)?.(
      { sender: contents },
      ['image.png', 'saved.png', '../escape.png', 'nope.png'],
    )

    expect(result).toMatchObject({ deleted: ['image.png'] })
    expect(existsSync(join(directory, aiMade))).toBe(false)
    expect(existsSync(join(directory, userInserted))).toBe(true)
    expect(existsSync(join(directory, saved))).toBe(true)
    expect(await readOwnedAssetManifest(documentPath)).toMatchObject({
      files: [{ name: 'mine.png' }, { name: 'saved.png' }],
      documents: { 'note.md': ['saved.png'] },
      pending: { 'note.md': ['mine.png'] },
    })
  })

  it('does nothing for a window without a document path or a malformed argument', async () => {
    const view = createMarkdownView(null)
    const contents = view.webContents as unknown as FakeWebContents
    await expect(
      handlers.get(MARKDOWN_CHANNELS.discardPendingAssets)?.({ sender: contents }, ['a.png']),
    ).resolves.toMatchObject({ deleted: [] })
    await expect(
      handlers.get(MARKDOWN_CHANNELS.discardPendingAssets)?.({ sender: contents }, 'a.png'),
    ).resolves.toMatchObject({ deleted: [] })
  })
})

describe('restoring the assets of a redone AI run', () => {
  it('drops a malformed or oversized entry and restores only the pictures that came through', async () => {
    const documentPath = await createDocument()
    const assetsDirectory = join(dirname(documentPath), 'assets')
    const view = createMarkdownView(documentPath)
    const contents = view.webContents as unknown as FakeWebContents
    const bytes = Buffer.from('run bytes')
    await writeImageIntoOwnedAssets(documentPath, 'image.png', bytes)
    await handlers.get(MARKDOWN_CHANNELS.discardPendingAssets)?.({ sender: contents }, [
      'image.png',
    ])

    const result = await handlers.get(MARKDOWN_CHANNELS.restorePendingAssets)?.(
      { sender: contents },
      [
        { name: 'image.png', base64: bytes.toString('base64') },
        { name: 'no-bytes.png' },
        { base64: bytes.toString('base64') },
        'image.png',
        {
          name: 'oversized.png',
          base64: 'A'.repeat(Math.ceil(MAX_PASTED_IMAGE_BYTES / 3) * 4 + 1),
        },
      ],
    )

    // the four rejected entries never reach the file system, and the short `restored` list is the
    // signal the panel uses to refuse the redo
    expect(result).toEqual({ restored: ['image.png'], errors: [] })
    expect(existsSync(join(assetsDirectory, 'image.png'))).toBe(true)
    expect(existsSync(join(assetsDirectory, 'no-bytes.png'))).toBe(false)
    expect(existsSync(join(assetsDirectory, 'oversized.png'))).toBe(false)
  })

  it('answers every name as an error for a window without a document path', async () => {
    const view = createMarkdownView(null)
    const contents = view.webContents as unknown as FakeWebContents
    const files = [
      { name: 'a.png', base64: Buffer.from('a').toString('base64') },
      { name: 'b.png', base64: Buffer.from('b').toString('base64') },
    ]

    await expect(
      handlers.get(MARKDOWN_CHANNELS.restorePendingAssets)?.({ sender: contents }, files),
    ).resolves.toEqual({ restored: [], errors: ['a.png', 'b.png'] })
    // a malformed argument is not a restore request: nothing to report, nothing written
    await expect(
      handlers.get(MARKDOWN_CHANNELS.restorePendingAssets)?.({ sender: contents }, 'a.png'),
    ).resolves.toEqual({ restored: [], errors: [] })
  })
})

describe('first save of an untitled document (ask before writing, G6-09 W8)', () => {
  const save = (contents: FakeWebContents, request: Record<string, unknown>) =>
    handlers.get(MARKDOWN_CHANNELS.save)?.(
      { sender: contents },
      { text: '# Draft', imageSources: [], ...request },
    ) as Promise<{ ok: boolean; canceled?: boolean; path?: string }>

  async function targetIn(directory: string, name: string): Promise<string> {
    return join(directory, name)
  }

  it('an AI-suggested name only fills the Save dialog: nothing is written until it is confirmed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'markdown-first-save-'))
    temporaryDirectories.push(directory)
    const view = createMarkdownView(null)
    const contents = view.webContents as unknown as FakeWebContents
    showSaveDialogWithMemory.mockResolvedValue({ canceled: true })

    const result = await save(contents, { mode: 'save', suggestedName: 'Quarterly plan' })

    expect(result).toMatchObject({ ok: true, canceled: true })
    expect(showSaveDialogWithMemory).toHaveBeenCalledTimes(1)
    const options = showSaveDialogWithMemory.mock.calls[0]![2] as { defaultPath: string }
    expect(options.defaultPath.endsWith('Quarterly plan.md')).toBe(true)
    // nothing landed in the default save folder under the suggested name
    expect(existsSync(options.defaultPath)).toBe(false)

    const target = await targetIn(directory, 'Quarterly plan.md')
    showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: target })
    const confirmed = await save(contents, { mode: 'save', suggestedName: 'Quarterly plan' })
    expect(confirmed).toMatchObject({ ok: true, path: target })
    expect(await readFile(target, 'utf8')).toBe('# Draft')
  })

  it('Ctrl+S on an untitled document still opens the dialog with the untitled name', async () => {
    const view = createMarkdownView(null)
    const contents = view.webContents as unknown as FakeWebContents
    showSaveDialogWithMemory.mockResolvedValue({ canceled: true })

    await save(contents, { mode: 'save' })

    expect(showSaveDialogWithMemory).toHaveBeenCalledTimes(1)
    const options = showSaveDialogWithMemory.mock.calls[0]![2] as { defaultPath: string }
    expect(options.defaultPath).toMatch(/\.md$/)
    expect(options.defaultPath).not.toContain('Quarterly')
  })

  it('a titled document still saves in place with no dialog, whatever name is passed', async () => {
    const documentPath = await createDocument()
    const view = createMarkdownView(documentPath)
    const contents = view.webContents as unknown as FakeWebContents

    const result = await save(contents, { mode: 'save', suggestedName: 'Ignored' })

    expect(result).toMatchObject({ ok: true, path: documentPath })
    expect(showSaveDialogWithMemory).not.toHaveBeenCalled()
    expect(await readFile(documentPath, 'utf8')).toBe('# Draft')
  })
})
