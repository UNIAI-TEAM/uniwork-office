import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenDialogOptions } from 'electron'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'
import { UPLOAD_EXTENSIONS } from '../src/main/uniwork-docs/formats'
import { requestFirstSaveOpen } from '../src/main/uniwork-docs/first-save-open'

/**
 * G8-17 S18: the shell's own IPC bridge for create / upload / rename / archive
 * / restore and the two pushes (upload progress, renamed). The handlers must
 * exist under the contract's channel names, answer the action-result shape, and
 * the preload must expose the matching methods; a call that fails still answers
 * `{ ok: false, error }` rather than throwing across Electron.
 */

let dir: string
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null

/**
 * the options of every showOpenDialog call (a parent-less call passes one
 * argument), plus the result the next call answers (cancelled by default)
 */
const dialogs = vi.hoisted(() => ({
  open: [] as unknown[],
  result: { canceled: true, filePaths: [] as string[] },
  save: { canceled: true } as { canceled: boolean; filePath?: string },
  saveOptions: [] as unknown[],
}))

const downloadHooks = vi.hoisted(() => ({
  nextRandomBytes: null as Buffer | null,
  onRename: null as ((src: string, dest: string) => void) | null,
}))

vi.mock('node:crypto', async (importOriginal) => {
  const actual = (await importOriginal()) as { randomBytes: (size: number) => Buffer }
  return {
    ...actual,
    randomBytes: (size: number) => {
      if (downloadHooks.nextRandomBytes && size === 8) {
        const buf = downloadHooks.nextRandomBytes
        downloadHooks.nextRandomBytes = null
        return buf
      }
      return actual.randomBytes(size)
    },
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    rename: (src: string, dest: string) => Promise<void>
  }
  return {
    ...actual,
    rename: async (src: string, dest: string) => {
      if (downloadHooks.onRename) {
        const hook = downloadHooks.onRename
        downloadHooks.onRename = null
        hook(String(src), String(dest))
      }
      return actual.rename(src, dest)
    },
  }
})

vi.mock('electron', () => ({
  app: { getPath: () => dir, configureHostResolver: () => undefined },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {
    showOpenDialog: vi.fn(async (...args: unknown[]) => {
      dialogs.open.push(args.at(-1))
      return dialogs.result
    }),
    showMessageBox: vi.fn(async () => ({ response: 1 })),
    showSaveDialog: vi.fn(async (...args: unknown[]) => {
      dialogs.saveOptions.push(args.at(-1))
      return dialogs.save
    }),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`ENC1${text}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
  session: {
    defaultSession: {
      setSpellCheckerDictionaryDownloadURL: () => undefined,
      getSpellCheckerLanguages: () => ['en-US'],
      setSpellCheckerLanguages: () => undefined,
      isSpellCheckerEnabled: () => true,
      setSpellCheckerEnabled: () => undefined,
    },
  },
}))

vi.mock('../src/main/uniwork-auth', () => ({
  // the real module runs the caller's request with the live token; a call that
  // reaches the network here must see the same
  authorizedRequest: <T>(call: (token: string) => Promise<T>) => call('tok'),
  setUniworkSignOutHooks: vi.fn(),
  onUniworkAccountStatus: () => () => undefined,
  uniworkAccount: () => ({
    status: () => ({ state: 'signed-in', org: { id: 'org_a', slug: 'acme' } }),
  }),
  uniworkAppChannel: () => 'stable',
  uniworkDeploymentProfile: () => ({
    deploymentId: 'default',
    apiOrigin: 'https://uniwork.example',
    clientId: 'uniwork-office',
    channel: 'stable',
  }),
  uniworkSessionIdentity: () => identity,
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-actions-wiring-'))
  identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
  dialogs.open.length = 0
  dialogs.result = { canceled: true, filePaths: [] }
  dialogs.save = { canceled: true }
  dialogs.saveOptions.length = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function setup() {
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const sent: Array<{ channel: string; payload: unknown }> = []
  const wc = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload })
    },
  }
  const notifyPathRenamed = vi.fn()
  const handle = createUniworkDocs(
    {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    } as never,
    {
      shellWindow: () => null,
      shellContents: () => wc as never,
      openPath: () => true,
      refuseLockedPath: () => false,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => dir,
      openPaths: () => [],
      closePath: async () => true,
      confirmClosePath: async () => true,
      closePathNow: () => undefined,
      aiHistoryPaths: () => [],
      forgetAiHistory: () => undefined,
      notifyPathRenamed,
    },
  )
  return { handle, handlers, notifyPathRenamed, sent }
}

describe('the S18 action IPC', () => {
  it('registers every channel of the contract', async () => {
    const { handlers } = await setup()
    for (const channel of [
      UNIWORK_DOC_CHANNELS.createDocument,
      UNIWORK_DOC_CHANNELS.createPage,
      UNIWORK_DOC_CHANNELS.pickUploadFile,
      UNIWORK_DOC_CHANNELS.uploadDocument,
      UNIWORK_DOC_CHANNELS.cancelUpload,
      UNIWORK_DOC_CHANNELS.renameDocument,
      UNIWORK_DOC_CHANNELS.archiveDocument,
      UNIWORK_DOC_CHANNELS.restoreDocument,
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
    // the pushes are not invoke handlers
    expect(handlers.has(UNIWORK_DOC_CHANNELS.uploadProgress)).toBe(false)
    expect(handlers.has(UNIWORK_DOC_CHANNELS.docRenamed)).toBe(false)
  })

  it('answers the action-result shape, never throwing across IPC', async () => {
    const { handlers } = await setup()
    // a malformed input still answers an error result (the name is empty here)
    const result = await handlers.get(UNIWORK_DOC_CHANNELS.createDocument)!(null, {
      workspaceId: 'ws_1',
      folderId: null,
      name: '   ',
      format: 'docx',
    })
    expect(result).toEqual({ ok: false, error: 'name_empty' })
  })

  // UNI-1953 CT1-7: the create-page channel reaches service.createPage (an empty
  // name is refused there, before any request, with the same result shape)
  it('routes the create-page channel to the service createPage', async () => {
    const { handlers } = await setup()
    const result = await handlers.get(UNIWORK_DOC_CHANNELS.createPage)!(null, {
      workspaceId: 'ws_1',
      folderId: null,
      name: '   ',
    })
    expect(result).toEqual({ ok: false, error: 'name_empty' })
  })

  it('the upload dialog seam answers null when cancelled', async () => {
    const { handlers } = await setup()
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.pickUploadFile)!(null)).toBeNull()
  })

  it('offers the formats UniWork Office opens, with no all-files filter', async () => {
    const { handlers } = await setup()
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.pickUploadFile)!(null)).toBeNull()
    const options = dialogs.open.at(-1) as OpenDialogOptions
    // one "Documents" filter, whose extensions are the formats table's keys
    expect(options.filters).toHaveLength(1)
    expect(options.filters![0]!.name).toBe('Documents')
    const extensions = options.filters![0]!.extensions
    expect([...extensions].sort()).toEqual([...UPLOAD_EXTENSIONS].sort())
    // the reported gap: the hardcoded list missed markdown and htm
    expect(UPLOAD_EXTENSIONS).toEqual(expect.arrayContaining(['markdown', 'htm']))
    // no "All files": an image picked by mistake would upload but never open here
    expect(options.filters!.some((filter) => filter.extensions.includes('*'))).toBe(false)
  })

  // N-2a: a typed path outside the native filter is still returned to the
  // renderer so uploadDocument stays the single refusal authority and the
  // dialog can surface unsupported_format at the file field instead of
  // silently behaving like a cancel.
  it('passes a picked path through to the renderer regardless of extension', async () => {
    const { handlers } = await setup()
    dialogs.result = { canceled: false, filePaths: [join(dir, 'photo.png')] }
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.pickUploadFile)!(null)).toEqual({
      path: join(dir, 'photo.png'),
      name: 'photo.png',
    })

    dialogs.result = { canceled: false, filePaths: [join(dir, 'Q3 report.docx')] }
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.pickUploadFile)!(null)).toEqual({
      path: join(dir, 'Q3 report.docx'),
      name: 'Q3 report.docx',
    })
  })

  it('refuses every action while signed out, before any request', async () => {
    const { handlers } = await setup()
    identity = null
    expect(
      await handlers.get(UNIWORK_DOC_CHANNELS.renameDocument)!(null, 'doc_1', 'Nope.docx'),
    ).toEqual({ ok: false, error: 'not_signed_in' })
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.archiveDocument)!(null, 'doc_1')).toEqual({
      ok: false,
      error: 'not_signed_in',
    })
    expect(
      await handlers.get(UNIWORK_DOC_CHANNELS.createDocument)!(null, {
        workspaceId: 'ws_1',
        folderId: null,
        name: 'Plan',
        format: 'docx',
      }),
    ).toEqual({ ok: false, error: 'not_signed_in' })
  })

  it('registers the FD-11 folder channels and answers them from the service', async () => {
    const { handlers } = await setup()
    for (const channel of [
      UNIWORK_DOC_CHANNELS.folderTree,
      UNIWORK_DOC_CHANNELS.listChildren,
      UNIWORK_DOC_CHANNELS.searchDocuments,
      UNIWORK_DOC_CHANNELS.createFolder,
      UNIWORK_DOC_CHANNELS.moveDocument,
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
    // the tree-changed notice is a push, never an invoke handler
    expect(handlers.has(UNIWORK_DOC_CHANNELS.treeChanged)).toBe(false)

    // a malformed input still answers a result instead of throwing across IPC
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.folderTree)!(null, 7)).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(
      await handlers.get(UNIWORK_DOC_CHANNELS.createFolder)!(null, {
        workspaceId: 'ws_1',
        parentId: null,
        title: '  ',
      }),
    ).toEqual({ ok: false, error: 'name_empty' })
  })

  it('pushes the tree-changed event once an own folder action landed', async () => {
    const { handlers, sent } = await setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).endsWith('/workspaces/ws_1/documents') && init.method === 'POST') {
          return new Response(
            JSON.stringify({
              document: {
                id: 'fold_9',
                kind: 'folder',
                workspace_id: 'ws_1',
                title: 'Contracts',
                revision: '1',
                updated_at: '2026-10-16T09:00:00Z',
                my_level: 'manage',
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('{}', { status: 404 })
      }),
    )
    try {
      const created = await handlers.get(UNIWORK_DOC_CHANNELS.createFolder)!(null, {
        workspaceId: 'ws_1',
        parentId: null,
        title: 'Contracts',
      })
      expect(created).toMatchObject({ ok: true, value: { id: 'fold_9', kind: 'folder' } })

      // the push is coalesced, so it arrives a window after the action
      await vi.waitFor(() =>
        expect(sent.some((message) => message.channel === UNIWORK_DOC_CHANNELS.treeChanged)).toBe(
          true,
        ),
      )
      const treeChanged = sent.filter(
        (message) => message.channel === UNIWORK_DOC_CHANNELS.treeChanged,
      )
      expect(treeChanged).toHaveLength(1)
      expect(treeChanged[0]!.payload).toEqual({ workspaceId: 'ws_1' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('FD11-C-R1-06: pushes tree-changed over IPC when a feed page (including removal-only) commits through createSyncRuntime', async () => {
    const { handle, sent } = await setup()
    const { createSyncRuntime } = await import('../src/main/uniwork-docs/wiring')
    const { createTreeChangedCoalescer } = await import('../src/main/uniwork-docs/tree-changed')
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) =>
        sent.push({ channel: UNIWORK_DOC_CHANNELS.treeChanged, payload: { workspaceId } }),
    })
    const runtime = createSyncRuntime(handle.service, {
      treeChanged: (workspaceId) => coalescer.notify(workspaceId),
      fetch: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('/orgs/org_a/office/capabilities')) {
          return new Response(
            JSON.stringify({
              sync_feed: true,
              sync_write: true,
              offline_library: false,
              ai_uniwork: false,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.pathname.endsWith('/orgs/org_a/workspaces')) {
          return new Response(
            JSON.stringify({ workspaces: [{ id: 'ws_1', name: 'Workspace 1', slug: 'ws-1' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.pathname.endsWith('/workspaces/ws_1/documents/changes')) {
          return new Response(
            JSON.stringify({
              phase: 'feed',
              changes: [],
              feed: [
                {
                  document_id: 'doc_1',
                  change_kind: 'removal',
                  kind: '',
                  revision: 9,
                  current_version: 0,
                  version_id: null,
                  archived: false,
                  removal: 'permission_revoked',
                },
              ],
              has_more: false,
              next_cursor: 'feed:1',
              expires_at: '2026-10-20T00:00:00Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('{}', { status: 404 })
      },
    })

    await runtime.tick()
    await vi.waitFor(() =>
      expect(sent.some((message) => message.channel === UNIWORK_DOC_CHANNELS.treeChanged)).toBe(
        true,
      ),
    )
    expect(sent.filter((message) => message.channel === UNIWORK_DOC_CHANNELS.treeChanged)).toEqual([
      { channel: UNIWORK_DOC_CHANNELS.treeChanged, payload: { workspaceId: 'ws_1' } },
    ])
  })
})

describe('the SAVE-01 first-save IPC (S01-R1-7)', () => {
  it('registers the first-save, ensure-my-folder and ack channels, not the push', async () => {
    const { handlers } = await setup()
    for (const channel of [
      UNIWORK_DOC_CHANNELS.firstSave,
      UNIWORK_DOC_CHANNELS.ensureMyFolder,
      UNIWORK_DOC_CHANNELS.firstSaveOpenAck,
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
    // first-save-open is a push to the shell renderer, never an invoke handler
    expect(handlers.has(UNIWORK_DOC_CHANNELS.firstSaveOpen)).toBe(false)
  })

  it('a malformed first-save target answers invalid_destination with zero requests', async () => {
    const { handlers } = await setup()
    const fetch = vi.fn(async () => new Response('{}', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    try {
      const file = join(dir, 'Draft.docx')
      const result = await handlers.get(UNIWORK_DOC_CHANNELS.firstSave)!(null, {
        tabPath: file,
        title: 'Draft.docx',
        workspaceId: 'ws_1',
        // an empty folder id is an unknown destination, not a root create
        target: { kind: 'folder', folderId: '   ' },
      })
      expect(result).toEqual({ ok: false, error: 'invalid_destination' })
      // the union is refused before stat/read/POST: nothing left the process
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a malformed workspace id still answers a result instead of throwing', async () => {
    const { handlers } = await setup()
    const result = await handlers.get(UNIWORK_DOC_CHANNELS.firstSave)!(null, {
      tabPath: 7,
      title: 'Draft.docx',
      workspaceId: 'ws_1',
      target: { kind: 'my_folder' },
    })
    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('ensureMyFolder posts to the my-folder route and answers the folder', async () => {
    const { handlers } = await setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (
          String(url).endsWith('/workspaces/ws_1/documents/my-folder') &&
          init.method === 'POST'
        ) {
          return new Response(
            JSON.stringify({
              document: {
                id: 'fold_my',
                kind: 'folder',
                workspace_id: 'ws_1',
                title: 'My Folder',
                updated_at: '2026-10-17T09:00:00Z',
                my_level: 'manage',
                system_kind: 'my_folder',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('{}', { status: 404 })
      }),
    )
    try {
      const result = (await handlers.get(UNIWORK_DOC_CHANNELS.ensureMyFolder)!(null, 'ws_1')) as {
        ok: boolean
        value?: { id: string; systemKind?: string }
      }
      expect(result.ok).toBe(true)
      expect(result.value?.id).toBe('fold_my')
      expect(result.value?.systemKind).toBe('my_folder')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the firstSaveOpenAck invoke releases the pending waiter of its sender+path', async () => {
    const { handlers } = await setup()
    const wc = { id: 42, isDestroyed: () => false, send: vi.fn() }
    const pending = requestFirstSaveOpen(wc, 'C:/tmp/Draft.docx', 5_000)
    // the renderer's invoke carries the sender's own webContents id
    handlers.get(UNIWORK_DOC_CHANNELS.firstSaveOpenAck)!(
      { sender: { id: 42 } },
      'C:/tmp/Draft.docx',
    )
    expect(await pending).toBe(true)
    expect(wc.send).toHaveBeenCalledWith(UNIWORK_DOC_CHANNELS.firstSaveOpen, {
      path: 'C:/tmp/Draft.docx',
    })
  })

  it('an ack from a different sender or path releases nothing', async () => {
    const { handlers } = await setup()
    const wc = { id: 42, isDestroyed: () => false, send: vi.fn() }
    const pending = requestFirstSaveOpen(wc, 'C:/tmp/Draft.docx', 30)
    const ack = handlers.get(UNIWORK_DOC_CHANNELS.firstSaveOpenAck)!
    // foreign sender, foreign path, empty path: all no-ops
    ack({ sender: { id: 9 } }, 'C:/tmp/Draft.docx')
    ack({ sender: { id: 42 } }, 'C:/tmp/Other.docx')
    ack({ sender: { id: 42 } }, '')
    expect(await pending).toBe(false)
  })

  it('registers listSharedByMe and listTrash IPC handlers and routes them to the service', async () => {
    const { handlers } = await setup()
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        seen.push(String(input))
        const url = new URL(String(input))
        if (url.pathname === '/api/v1/workspaces/ws_1/members') {
          return new Response(
            JSON.stringify({
              members: [{ user_id: 'u_1', display_name: 'Alice' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({
            documents: [
              {
                id: 'doc_1',
                workspace_id: 'ws_1',
                title: 'Shared.docx',
                kind: 'file',
                updated_at: '2026-10-17T09:00:00Z',
                updated_by: 'u_1',
                visibility: 'restricted',
                my_level: 'manage',
              },
            ],
            next_cursor: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )
    try {
      const sharedByMe = (await handlers.get(UNIWORK_DOC_CHANNELS.listSharedByMe)!(null, {
        workspaceId: 'ws_1',
        format: 'docx',
      })) as { ok: boolean; value?: { documents: Array<{ id: string; updatedByName?: string }> } }
      expect(sharedByMe.ok).toBe(true)
      expect(sharedByMe.value?.documents[0]).toMatchObject({
        id: 'doc_1',
        updatedByName: 'Alice',
      })

      const trash = (await handlers.get(UNIWORK_DOC_CHANNELS.listTrash)!(null, {
        workspaceId: 'ws_1',
      })) as { ok: boolean; value?: { documents: Array<{ id: string; updatedByName?: string }> } }
      expect(trash.ok).toBe(true)
      expect(trash.value?.documents[0]).toMatchObject({
        id: 'doc_1',
        updatedByName: 'Alice',
      })

      expect(seen.some((u) => u.includes('shared_by_me=true') && u.includes('format=docx'))).toBe(
        true,
      )
      expect(seen.some((u) => u.includes('archived=1'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // DH1-BE-3: the service hop is what carries the filters to the client. A
  // future edit that drops `listFiltersOf` from one of these methods leaves the
  // direct-client URL tests passing, so this asserts the OUTGOING request the
  // fake HTTP layer receives for each list method through the IPC path.
  it('forwards format, updated_by and updated_from through the service for listChildren, listDocuments and listTrash (DH1-BE-3)', async () => {
    const { handlers } = await setup()
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        seen.push(String(input))
        const url = new URL(String(input))
        if (url.pathname === '/api/v1/workspaces/ws_1/members') {
          return new Response(JSON.stringify({ members: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ documents: [], next_cursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    const filters = {
      format: 'docx',
      updatedBy: 'u_9',
      updatedFrom: '2026-10-01T00:00:00Z',
    }
    try {
      const children = await handlers.get(UNIWORK_DOC_CHANNELS.listChildren)!(null, {
        workspaceId: 'ws_1',
        parentId: null,
        ...filters,
      })
      const docs = await handlers.get(UNIWORK_DOC_CHANNELS.listDocuments)!(null, {
        workspaceId: 'ws_1',
        ...filters,
      })
      const trash = await handlers.get(UNIWORK_DOC_CHANNELS.listTrash)!(null, {
        workspaceId: 'ws_1',
        ...filters,
      })
      // the handler answers `unknown`; read only the boolean we assert on
      const okOf = (result: unknown): boolean =>
        typeof result === 'object' && result !== null && 'ok' in result && result.ok === true
      expect([children, docs, trash].map(okOf)).toEqual([true, true, true])

      const queryOf = (match: (url: URL) => boolean): URLSearchParams => {
        const found = seen.map((u) => new URL(u)).filter(match)
        expect(found).toHaveLength(1)
        return found[0]!.searchParams
      }
      // listChildren: the folder route, filters plus the empty-root parent_id
      const childParams = queryOf((u) => u.searchParams.get('parent_id') === '')
      expect(childParams.get('format')).toBe('docx')
      expect(childParams.get('updated_by')).toBe('u_9')
      expect(childParams.get('updated_from')).toBe('2026-10-01T00:00:00Z')
      // listDocuments: updater/date force the flat workspace list, filters included
      const docParams = queryOf(
        (u) => u.pathname === '/api/v1/workspaces/ws_1/documents' && u.searchParams.has('kind'),
      )
      expect(docParams.get('format')).toBe('docx')
      expect(docParams.get('updated_by')).toBe('u_9')
      expect(docParams.get('updated_from')).toBe('2026-10-01T00:00:00Z')
      // listTrash: the archived route, filters included
      const trashParams = queryOf((u) => u.searchParams.get('archived') === '1')
      expect(trashParams.get('format')).toBe('docx')
      expect(trashParams.get('updated_by')).toBe('u_9')
      expect(trashParams.get('updated_from')).toBe('2026-10-01T00:00:00Z')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// UNI-1961: the Documents home's "other sources" rows (list + download) reach
// main through their own channels.
describe('the document sources IPC (UNI-1961)', () => {
  const sourcesBody = {
    items: [
      {
        id: 'task:src_1',
        source: 'task',
        parent: { kind: 'task', id: 'task_1', title: 'Chuẩn bị họp' },
        name: 'Biên bản.docx',
        size_bytes: 12,
        updated_at: '2026-10-19T08:00:00Z',
        owner: { id: 'u_1', kind: 'user', name: 'Minh Trần' },
      },
    ],
    next_cursor: null,
  }

  it('routes listSources to the server with its filters', async () => {
    const { handlers } = await setup()
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        seen.push(String(input))
        return new Response(JSON.stringify(sourcesBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    try {
      const page = (await handlers.get(UNIWORK_DOC_CHANNELS.listSources)!(null, {
        workspaceId: 'ws_1',
        type: 'docx',
        cursor: 'c_1',
      })) as { ok: boolean; value?: { items: Array<{ id: string }>; nextCursor: string | null } }
      expect(page.ok).toBe(true)
      expect(page.value?.items.map((item) => item.id)).toEqual(['task:src_1'])
      expect(page.value?.nextCursor).toBeNull()
      expect(seen).toEqual([
        'https://uniwork.example/api/v1/workspaces/ws_1/documents/sources?type=docx&cursor=c_1&limit=50',
      ])
      // a call without a workspace never reaches the server
      expect(await handlers.get(UNIWORK_DOC_CHANNELS.listSources)!(null, {})).toEqual({
        ok: false,
        error: 'not_found',
      })
      expect(seen).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('downloads canonical compound source ids into the picked path, preserves extensions on long names, and refuses malformed ids before the dialog (R1-1, R1-10)', async () => {
    const { handlers } = await setup()
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        seen.push(String(input))
        return new Response(new Uint8Array([7, 8, 9]), { status: 200 })
      }),
    )
    try {
      dialogs.saveOptions.length = 0
      for (const bad of ['src_1', '../x', 'other:att_1', 'task:att/1']) {
        expect(
          await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
            workspaceId: 'ws_1',
            sourceId: bad,
            name: 'Biên bản.docx',
          }),
        ).toEqual({ ok: false, error: 'not_found' })
      }
      expect(dialogs.saveOptions).toHaveLength(0)
      expect(seen).toEqual([])

      const cancelled = await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
        workspaceId: 'ws_1',
        sourceId: 'task:src_1',
        name: `${'a'.repeat(200)}.pdf`,
      })
      expect(cancelled).toEqual({ ok: true, value: { path: null } })
      expect(seen).toEqual([])
      const longOpt = dialogs.saveOptions.at(-1) as {
        defaultPath?: string
        filters?: Array<{ extensions?: string[] }>
      }
      expect(longOpt.defaultPath).toBe(join(dir, `${'a'.repeat(196)}.pdf`))
      expect(longOpt.filters?.[0]?.extensions).toEqual(['pdf'])

      for (const prefix of ['chat', 'task', 'meeting', 'email'] as const) {
        const target = join(dir, `${prefix}-Biên bản.docx`)
        dialogs.save = { canceled: false, filePath: target }
        const saved = await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
          workspaceId: 'ws_1',
          sourceId: `${prefix}:src_1`,
          name: '../../Biên bản.docx',
        })
        const lastOpt = dialogs.saveOptions.at(-1) as { defaultPath?: string }
        const suggested = lastOpt.defaultPath ?? ''
        expect(suggested.endsWith('Biên bản.docx')).toBe(true)
        expect(suggested).not.toContain('..')
        expect(saved).toEqual({ ok: true, value: { path: target } })
        expect([...readFileSync(target)]).toEqual([7, 8, 9])
      }
      expect(seen).toEqual([
        'https://uniwork.example/api/v1/workspaces/ws_1/documents/sources/chat%3Asrc_1/download',
        'https://uniwork.example/api/v1/workspaces/ws_1/documents/sources/task%3Asrc_1/download',
        'https://uniwork.example/api/v1/workspaces/ws_1/documents/sources/meeting%3Asrc_1/download',
        'https://uniwork.example/api/v1/workspaces/ws_1/documents/sources/email%3Asrc_1/download',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('cancels an oversized streamed source download at the cap and leaves an existing destination unchanged (R1-4, R1-12)', async () => {
    const { handlers } = await setup()
    const target = join(dir, 'existing.docx')
    writeFileSync(target, new Uint8Array([1, 2, 3]))
    dialogs.save = { canceled: false, filePath: target }
    const chunk = new Uint8Array(16 * 1024 * 1024)
    let pulls = 0
    let cancelled = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulls += 1
              if (pulls > 20) {
                controller.close()
                return
              }
              controller.enqueue(chunk)
            },
            cancel() {
              cancelled = true
            },
          },
          { highWaterMark: 0 },
        )
        return new Response(body, { status: 200 })
      }),
    )
    try {
      const res = await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
        workspaceId: 'ws_1',
        sourceId: 'task:src_1',
        name: 'existing.docx',
      })
      expect(res).toEqual({ ok: false, error: 'too_large' })
      expect(cancelled).toBe(true)
      expect(pulls).toBe(17)
      expect([...readFileSync(target)]).toEqual([1, 2, 3])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses direct store targets, final symlinks, parent-directory symlinks, and held-download symlink replacements without modifying protected bytes (R1-6, R1-13, R1-16)', async () => {
    const { handlers } = await setup()
    const storeDir = join(dir, 'uniwork-documents', 'default', 'acc_1', 'doc_1')
    mkdirSync(storeDir, { recursive: true })
    const storeFile = join(storeDir, 'Protected.docx')
    writeFileSync(storeFile, new Uint8Array([10, 20, 30]))

    const finalLink = join(dir, 'alias.docx')
    symlinkSync(storeFile, finalLink)
    const parentLink = join(dir, 'linked-store')
    symlinkSync(storeDir, parentLink)
    const viaParentLink = join(parentLink, 'Protected.docx')

    let fetches = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetches += 1
        return new Response(new Uint8Array([7, 8, 9]), { status: 200 })
      }),
    )
    try {
      for (const candidate of [storeFile, finalLink, viaParentLink]) {
        dialogs.save = { canceled: false, filePath: candidate }
        const res = await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
          workspaceId: 'ws_1',
          sourceId: 'task:src_1',
          name: 'Protected.docx',
        })
        expect(res).toEqual({ ok: false, error: 'forbidden' })
        expect([...readFileSync(storeFile)]).toEqual([10, 20, 30])
      }
      expect(fetches).toBe(0)

      const raceTarget = join(dir, 'race-target.docx')
      let releaseFetch: ((res: Response) => void) | undefined
      let markFetchEntered: () => void = () => undefined
      const fetchEntered = new Promise<void>((resolve) => {
        markFetchEntered = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              releaseFetch = resolve
              markFetchEntered()
            }),
        ),
      )
      dialogs.save = { canceled: false, filePath: raceTarget }
      const pending = handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
        workspaceId: 'ws_1',
        sourceId: 'task:src_1',
        name: 'Protected.docx',
      })
      await fetchEntered
      symlinkSync(storeFile, raceTarget)
      releaseFetch!(new Response(new Uint8Array([7, 8, 9]), { status: 200 }))
      expect(await pending).toEqual({ ok: false, error: 'forbidden' })
      expect([...readFileSync(storeFile)]).toEqual([10, 20, 30])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stages source downloads through a private exclusive sibling temp file, preserves destination mode (0600 and 0660) under permissive umask, and cleans up on write or rename failure (R1-5, R2-2, R2-7, R2-10, R3-7)', async () => {
    const { handlers } = await setup()
    const subDir = join(dir, 'target-dir')
    mkdirSync(subDir, { recursive: true })
    const target = join(subDir, 'existing.docx')
    writeFileSync(target, new Uint8Array([1, 2, 3, 4]))
    chmodSync(target, 0o600)
    chmodSync(subDir, 0o500)
    dialogs.save = { canceled: false, filePath: target }
    const prevUmask = process.umask(0o002)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([7, 8, 9, 10]), { status: 200 })),
    )
    try {
      const failed = await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
        workspaceId: 'ws_1',
        sourceId: 'task:src_1',
        name: 'existing.docx',
      })
      expect(failed).toEqual({ ok: false, error: 'server_error' })
      expect([...readFileSync(target)]).toEqual([1, 2, 3, 4])
      expect(readdirSync(subDir)).toEqual(['existing.docx'])

      // R2-7: rename failure after the staged file has been written cleans up the staged sibling and leaves target unchanged
      chmodSync(subDir, 0o700)
      let stagedBytesAtRename: number[] = []
      downloadHooks.onRename = (src) => {
        stagedBytesAtRename = [...readFileSync(src)]
        throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
      }
      dialogs.save = { canceled: false, filePath: target }
      const renameFailed = await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
        workspaceId: 'ws_1',
        sourceId: 'task:src_1',
        name: 'existing.docx',
      })
      expect(renameFailed).toEqual({ ok: false, error: 'server_error' })
      expect(stagedBytesAtRename).toEqual([7, 8, 9, 10])
      expect([...readFileSync(target)]).toEqual([1, 2, 3, 4])
      expect(readdirSync(subDir)).toEqual(['existing.docx'])

      // R2-2, R2-10: successful replacement preserves 0o600 mode even under permissive umask 0o002
      dialogs.save = { canceled: false, filePath: target }
      const saved = await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
        workspaceId: 'ws_1',
        sourceId: 'task:src_1',
        name: 'existing.docx',
      })
      expect(saved).toEqual({ ok: true, value: { path: target } })
      expect([...readFileSync(target)]).toEqual([7, 8, 9, 10])
      expect(statSync(target).mode & 0o777).toBe(0o600)
      expect(readdirSync(subDir)).toEqual(['existing.docx'])

      // R3-7: existing destination mode 0o660 also survives replacement under permissive umask
      writeFileSync(target, new Uint8Array([1, 2, 3, 4]))
      chmodSync(target, 0o660)
      dialogs.save = { canceled: false, filePath: target }
      const saved660 = await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
        workspaceId: 'ws_1',
        sourceId: 'task:src_1',
        name: 'existing.docx',
      })
      expect(saved660).toEqual({ ok: true, value: { path: target } })
      expect([...readFileSync(target)]).toEqual([7, 8, 9, 10])
      expect(statSync(target).mode & 0o777).toBe(0o660)
      expect(readdirSync(subDir)).toEqual(['existing.docx'])
    } finally {
      downloadHooks.onRename = null
      process.umask(prevUmask)
      chmodSync(subDir, 0o700)
      vi.unstubAllGlobals()
    }
  })

  it('downloads into a valid 240-byte destination basename using a short independent staging name (R2-4)', async () => {
    const { handlers } = await setup()
    const subDir = join(dir, 'long-dir')
    mkdirSync(subDir, { recursive: true })
    const longName = `${'a'.repeat(235)}.docx`
    expect(Buffer.byteLength(longName, 'utf8')).toBe(240)
    const longTarget = join(subDir, longName)
    writeFileSync(longTarget, new Uint8Array([1, 2, 3, 4]))
    dialogs.save = { canceled: false, filePath: longTarget }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([7, 8, 9, 10]), { status: 200 })),
    )
    try {
      const saved = await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
        workspaceId: 'ws_1',
        sourceId: 'task:src_1',
        name: longName,
      })
      expect(saved).toEqual({ ok: true, value: { path: longTarget } })
      expect([...readFileSync(longTarget)]).toEqual([7, 8, 9, 10])
      expect(readdirSync(subDir)).toEqual([longName])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves both a colliding sibling and the destination on an exclusive staging EEXIST collision (R2-5, R2-11)', async () => {
    const { handlers } = await setup()
    const subDir = join(dir, 'collision-dir')
    mkdirSync(subDir, { recursive: true })
    const target = join(subDir, 'existing.docx')
    writeFileSync(target, new Uint8Array([1, 2, 3, 4]))
    const legacySibling = join(subDir, '.existing.docx.deadbeefdeadbeef.tmp')
    const shortSibling = join(subDir, '.uw-dl-deadbeefdeadbeef.tmp')
    writeFileSync(legacySibling, new Uint8Array([99, 98, 97]))
    writeFileSync(shortSibling, new Uint8Array([99, 98, 97]))
    downloadHooks.nextRandomBytes = Buffer.from('deadbeefdeadbeef', 'hex')
    dialogs.save = { canceled: false, filePath: target }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([7, 8, 9, 10]), { status: 200 })),
    )
    try {
      const failed = await handlers.get(UNIWORK_DOC_CHANNELS.downloadSource)!(null, {
        workspaceId: 'ws_1',
        sourceId: 'task:src_1',
        name: 'existing.docx',
      })
      expect(failed).toEqual({ ok: false, error: 'server_error' })
      expect([...readFileSync(target)]).toEqual([1, 2, 3, 4])
      expect([...readFileSync(legacySibling)]).toEqual([99, 98, 97])
      expect([...readFileSync(shortSibling)]).toEqual([99, 98, 97])
    } finally {
      downloadHooks.nextRandomBytes = null
      vi.unstubAllGlobals()
    }
  })
})
