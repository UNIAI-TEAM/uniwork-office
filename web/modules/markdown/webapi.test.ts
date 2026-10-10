// @vitest-environment jsdom
// GO-B4 M-1/M-2 (UNI-1014): window.markdownApi over a mocked frame port.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installModuleBridge } from '../../docs/bridge/module-bridge'
import { createMockPort, type MockPort } from '../../docs/bridge/testing/mock-port'
import type { Capabilities } from '../../docs/protocol/types'
import {
  DRAFTS_DB,
  DRAFTS_STORE,
  createDraftRecovery,
  createIdbDraftStore,
  decryptDraft,
  type DraftChoice,
  type DraftInfo,
  type DraftRecord,
  type DraftRecovery,
  type DraftStore,
} from '../../docs/bridge/draft-recovery'
import { createFakeIdb } from '../../docs/bridge/testing/fake-idb'
import { TEXT_MODULE_WEB_CAPABILITIES, textModuleGrants } from '../shared/capabilities'
import type { TextWebApiOptions } from '../shared/text-webapi'
import { MARKDOWN_WEB_CAPABILITIES, createMarkdownWebApi } from './webapi'

type Api = ReturnType<typeof createMarkdownWebApi> & { capabilities: Record<string, unknown> }

const enc = (s: string) => new TextEncoder().encode(s)
// BOM + CRLF + raw HTML: the bridge must hand back exactly these bytes
const FIXTURE = new Uint8Array([
  0xef,
  0xbb,
  0xbf,
  ...enc('# Notes\r\n\r\n<!-- keep -->\r\n\r\nText ä\r\n'),
])

const FULL: Capabilities = { save: true, saveAs: true, print: true, exportPdf: true, images: true }

function setup(
  opts: {
    caps?: Capabilities
    bytes?: Uint8Array
    name?: string
    drafts?: TextWebApiOptions['drafts']
  } = {},
) {
  const mock = createMockPort()
  const file = mock.seed(opts.name ?? 'Notes.md', opts.bytes ?? FIXTURE)
  const print = vi.fn(async (_html: string) => ({ ok: true }))
  const reload = vi.fn()
  const target: Record<string, unknown> = {}
  installModuleBridge({
    module: 'markdown',
    frameCapabilities: FULL,
    capabilities: {
      defaults: { ...TEXT_MODULE_WEB_CAPABILITIES, ...MARKDOWN_WEB_CAPABILITIES },
      grants: textModuleGrants,
    },
    globals: {
      markdownApi: (ctx) => createMarkdownWebApi(ctx, { print, reload, drafts: opts.drafts }),
    },
    client: mock.port,
    target,
  })
  const api = target.markdownApi as Api
  mock.init({ documentId: file.fileId, capabilities: opts.caps ?? FULL })
  return { mock, file, api, print, reload }
}

async function open(api: Api): Promise<{ path: string; text: string }> {
  const path = (await api.consumePending())!
  return { path, text: await api.readFile(path) }
}

function lastSave(mock: MockPort) {
  return mock.calls.filter((c) => c.type === 'api.save').at(-1)?.payload as
    { fileId: string; data: ArrayBuffer; etag?: string; auto?: boolean } | undefined
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('markdownApi: open and save', () => {
  it('opens the document as text with the BOM and CRLF intact', async () => {
    const { api, mock, file } = setup()
    const { path, text } = await open(api)
    expect(path).toBe(`uniwork://files/${file.fileId}/Notes.md`)
    expect(text.startsWith('﻿# Notes\r\n')).toBe(true)
    expect(text).toContain('<!-- keep -->')
    expect(mock.titles).toContain('Notes.md')
  })

  it('open -> save without edits writes the exact input bytes, with If-Match, never auto', async () => {
    const { api, mock, file } = setup()
    const { text } = await open(api)
    const res = await api.save({ text, imageSources: [], mode: 'save' })
    expect(res).toEqual({ ok: true, path: `uniwork://files/${file.fileId}/Notes.md` })
    const sent = lastSave(mock)!
    expect(new Uint8Array(sent.data)).toEqual(FIXTURE)
    expect(sent.etag).toBe(file.etag)
    expect(sent.auto).toBeUndefined()
    expect(mock.bytesOf(file.fileId)).toEqual(FIXTURE)
    expect(mock.saved.at(-1)).toMatchObject({ initiatedByFrame: true })
  })

  it('the next save uses the new etag; dirty is mirrored to the host', async () => {
    const { api, mock } = setup()
    const { text } = await open(api)
    api.setDirty(true)
    await api.save({ text: `${text}more\r\n`, imageSources: [], mode: 'save' })
    api.setDirty(false)
    await api.save({ text, imageSources: [], mode: 'save' })
    expect(mock.calls.filter((c) => c.type === 'api.save').length).toBe(2)
    expect(mock.dirty).toEqual([true, false])
    expect(await mock.host['doc.closeCheck']({})).toEqual({ dirty: false, autoSave: false })
  })

  it('Save As goes through api.saveAs with a .md name and the source file', async () => {
    const { api, mock, file } = setup()
    const { text } = await open(api)
    const res = await api.save({ text, imageSources: [], mode: 'saveAs' })
    expect(res.ok && 'path' in res && res.path).toMatch(/Notes\.md$/)
    const call = mock.calls.find((c) => c.type === 'api.saveAs')!
    expect(call.payload).toMatchObject({ name: 'Notes.md', sourceFileId: file.fileId })
  })

  it('a cancelled host dialog is a quiet cancel', async () => {
    const { api, mock } = setup()
    const { text } = await open(api)
    mock.override('api.saveAs', () => ({ ok: false, error: { code: 'cancelled', message: 'x' } }))
    expect(await api.save({ text, imageSources: [], mode: 'saveAs' })).toEqual({
      ok: true,
      canceled: true,
    })
  })
})

describe('markdownApi: save conflicts', () => {
  async function conflicted() {
    const s = setup()
    const { text } = await open(s.api)
    s.mock.bumpRemote(s.file.fileId)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pending = s.api.save({ text: `${text}mine\r\n`, imageSources: [], mode: 'save' })
    await vi.waitFor(() =>
      expect(document.querySelector('[data-office-web="conflict"]')).not.toBeNull(),
    )
    const click = (choice: string) =>
      (document.querySelector(`[data-choice="${choice}"]`) as HTMLButtonElement).click()
    return { ...s, text, pending, click }
  }

  it('shows Reload latest / Overwrite / Cancel in the UI language, Overwrite destructive, Cancel focused', async () => {
    const { pending, click, mock } = await conflicted()
    const labels = [...document.querySelectorAll('[data-choice]')].map((b) => b.textContent)
    expect(labels).toEqual(['Reload latest', 'Overwrite', 'Cancel'])
    expect(document.querySelector('.ow-dlg-btn.danger')?.getAttribute('data-choice')).toBe(
      'overwrite',
    )
    expect(document.querySelector('.ow-dlg-btn.primary')).toBeNull()
    expect((document.activeElement as HTMLElement).dataset.choice).toBe('cancel')
    expect(mock.errors.at(-1)).toMatchObject({ fatal: false })
    click('cancel')
    expect((await pending).ok).toBe(false)
  })

  it('Overwrite re-reads the head etag and saves again', async () => {
    const { pending, click, mock, file } = await conflicted()
    click('overwrite')
    expect(await pending).toMatchObject({ ok: true })
    expect(new TextDecoder().decode(mock.bytesOf(file.fileId)!)).toContain('mine')
  })

  it('Reload latest drops the edits and reloads the frame (the host re-runs the handshake)', async () => {
    const { pending, click, reload, mock } = await conflicted()
    click('reload')
    expect((await pending).ok).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
    expect(mock.dirty.at(-1)).toBe(false)
  })

  it('a host `save` gets the conflict in its result and no dialog', async () => {
    const { api, mock, file } = setup()
    const { text } = await open(api)
    api.onSaveRequest(() => void api.save({ text: `${text}x`, imageSources: [], mode: 'save' }))
    api.setDirty(true)
    mock.bumpRemote(file.fileId)
    const res = await mock.host.save({ reason: 'user' })
    expect(res).toMatchObject({ ok: false, error: { code: 'conflict' } })
    expect(document.querySelector('[data-office-web="conflict"]')).toBeNull()
  })
})

describe('markdownApi: host requests', () => {
  it('host save runs the renderer save flow; clean documents answer at once', async () => {
    const { api, mock } = setup()
    const { text } = await open(api)
    const handler = vi.fn(() => void api.save({ text, imageSources: [], mode: 'save' }))
    api.onSaveRequest(handler)
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({ ok: true })
    expect(handler).not.toHaveBeenCalled()
    api.setDirty(true)
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({ ok: true })
    expect(handler).toHaveBeenCalledWith('save')
    expect(mock.saved.at(-1)).toMatchObject({ initiatedByFrame: false })
  })

  it('host save {reason: navigate} uses the close-save flow', async () => {
    const { api, mock } = setup()
    await open(api)
    api.setDirty(true)
    api.onCloseSaveRequest(() => api.sendCloseSaveResult(false))
    expect(await mock.host.save({ reason: 'navigate' })).toMatchObject({ ok: false })
  })

  it('host saveAs passes the host name to api.saveAs', async () => {
    const { api, mock } = setup()
    const { text } = await open(api)
    api.onSaveRequest((mode) => void api.save({ text, imageSources: [], mode }))
    const res = await mock.host.saveAs({ name: 'Copy' })
    expect(res).toMatchObject({ ok: true, file: { name: 'Copy.md' } })
  })

  it('host print runs the renderer PDF export into the print dialog', async () => {
    const { api, mock, print } = setup()
    await open(api)
    api.onExportRequest((format) => {
      expect(format).toBe('pdf')
      void api.exportPdf({ html: '<!doctype html><p>x</p>', suggestedName: 'Notes' })
    })
    expect(await mock.host.print({ mode: 'pdf' })).toEqual({ printed: true })
    expect(print).toHaveBeenCalledWith('<!doctype html><p>x</p>')
  })

  it('a host open after boot is refused (one document per frame load)', async () => {
    const { api, mock, file } = setup()
    await open(api)
    await expect(mock.host.open(mock.openPayload(file.fileId))).rejects.toMatchObject({
      code: 'unsupported',
    })
  })

  it('file.renamed updates the path, the title and the renderer', async () => {
    const { api, mock, file } = setup()
    await open(api)
    const seen: string[] = []
    api.onFileRenamed((p) => seen.push(p))
    mock.rename(file.fileId, 'Renamed.md')
    expect(seen).toEqual([`uniwork://files/${file.fileId}/Renamed.md`])
    expect(mock.titles.at(-1)).toBe('Renamed.md')
  })
})

describe('markdownApi: view only and capabilities', () => {
  it('web defaults hide AI, autosave and open-in-Docs; grants turn save/images on', async () => {
    const { api } = setup()
    await open(api)
    expect(api.capabilities).toMatchObject({
      platform: 'web',
      ai: false,
      autoSave: false,
      autoSaveToDisk: false,
      openInDocs: false,
      save: true,
      images: true,
    })
  })

  it('without the save grant: view only, every write refused, never dirty', async () => {
    const { api, mock } = setup({ caps: { print: true } })
    const { text } = await open(api)
    expect(api.capabilities.save).toBe(false)
    const res = await api.save({ text, imageSources: [], mode: 'save' })
    expect(res.ok).toBe(false)
    api.setDirty(true)
    expect(mock.dirty).toEqual([false])
    expect(mock.calls.some((c) => c.type === 'api.save')).toBe(false)
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
  })

  it('a file that is not UTF-8 opens view only (saving would rewrite its bytes)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api, mock } = setup({ bytes: new Uint8Array([0x61, 0xff, 0x0a]) })
    const { text } = await open(api)
    expect(api.capabilities.save).toBe(false)
    expect((await api.save({ text, imageSources: [], mode: 'save' })).ok).toBe(false)
    expect(mock.calls.some((c) => c.type === 'api.save')).toBe(false)
  })

  it('no autosave on the web: the shared preference answers off', async () => {
    const { api } = setup()
    expect(
      await (api as unknown as { getAutoSaveDefault: () => Promise<unknown> }).getAutoSaveDefault(),
    ).toEqual({ on: false, updatedAt: 0 })
  })
})

describe('markdownApi: pictures and exports', () => {
  it('relative pictures resolve through OpenPayload.assets', async () => {
    const mock = createMockPort()
    const file = mock.seed('Pics.md', enc('![a](assets/a.png)\n'))
    const target: Record<string, unknown> = {}
    installModuleBridge({
      module: 'markdown',
      frameCapabilities: FULL,
      globals: { markdownApi: (ctx) => createMarkdownWebApi(ctx) },
      client: mock.port,
      target,
    })
    const api = target.markdownApi as Api
    mock.init({
      documentId: file.fileId,
      capabilities: FULL,
      open: { ...mock.openPayload(file.fileId), assets: { 'assets/a.png': '/files/a' } },
    })
    await open(api)
    expect(api.resolveAssetUrl('assets/a.png')).toBe('/files/a')
    expect(api.resolveAssetUrl('./assets/a.png')).toBe('/files/a')
    expect(api.unresolveAssetUrl('/files/a')).toBe('assets/a.png')
    expect(api.resolveAssetUrl('assets/none.png')).toBeNull()
  })

  it('pasted pictures upload with the images grant, else embed as data: URIs', async () => {
    const withGrant = setup()
    await open(withGrant.api)
    expect(await withGrant.api.saveImage({ base64: 'AQID', ext: 'png' })).toMatch(/^assets\//)

    const noGrant = setup({ caps: { save: true } })
    await open(noGrant.api)
    expect(await noGrant.api.saveImage({ base64: 'AQID', ext: 'png' })).toBe(
      'data:image/png;base64,AQID',
    )
    expect(noGrant.mock.calls.some((c) => c.type === 'api.images.upload')).toBe(false)
  })

  it('exportDocx downloads the renderer-built bytes; open-in-Docs is refused', async () => {
    const { api } = setup()
    const create = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: () => {} })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(
      await api.exportDocx({ base64: 'UEsDBA==', suggestedName: 'Notes', mode: 'dialog' }),
    ).toEqual({ ok: true, path: 'Notes.docx' })
    expect(click).toHaveBeenCalledOnce()
    expect(
      (await api.exportDocx({ base64: 'UEsDBA==', suggestedName: 'Notes', mode: 'openInDocs' })).ok,
    ).toBe(false)
  })
})

describe('markdownApi: draft recovery (C18)', () => {
  const SCOPE = 'u1:doc-1'
  const dec = (b: ArrayBuffer) => new TextDecoder().decode(b)
  let disposers: Array<() => void> = []
  afterEach(() => {
    for (const d of disposers) d()
    disposers = []
  })

  /** one browser profile: the IndexedDB and the session key survive a frame reload */
  async function profile() {
    const fake = createFakeIdb()
    const store: DraftStore = createIdbDraftStore(fake.idb)
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const records = () =>
      (fake.store(DRAFTS_DB, DRAFTS_STORE) ?? new Map<string, unknown>()) as Map<
        string,
        DraftRecord
      >
    /** one frame load; `answer` = the user's choice in the Restore / Discard prompt */
    function frame(answer: DraftChoice = 'restore', caps: Capabilities = FULL) {
      let recovery: DraftRecovery | null = null
      const prompt = vi.fn(async (_d: DraftInfo) => answer)
      const s = setup({
        caps,
        drafts: (host) => {
          recovery = createDraftRecovery({
            module: 'markdown',
            host,
            prompt,
            store,
            recovery: () => ({ key, scope: SCOPE }),
            target: new EventTarget() as unknown as Window,
            intervalMs: 3_600_000,
          })
          disposers.push(() => recovery?.dispose())
          return recovery
        },
      })
      return { ...s, prompt, flush: () => recovery!.flush() }
    }
    return { key, records, frame }
  }

  it('writes the renderer text encrypted while dirty, never while clean', async () => {
    const p = await profile()
    const f = p.frame()
    const { text } = await open(f.api)
    f.api.provideText(() => `${text}draft line\r\n`)
    await f.flush()
    expect(p.records().size).toBe(0)

    f.api.setDirty(true)
    await f.flush()
    const [[key, record]] = [...p.records()]
    expect(key).toMatch(new RegExp(`^${SCOPE}:${f.file.etag}:[0-9a-f]{16}$`))
    expect(record).toMatchObject({ module: 'markdown', name: 'Notes.md', baseEtag: f.file.etag })
    expect(dec(record.ciphertext)).not.toContain('draft line')
    // the BOM is part of the saved bytes: keep it while decoding
    const plain = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      (await decryptDraft(p.key, key, record))!,
    )
    expect(plain.startsWith('\uFEFF# Notes\r\n')).toBe(true)
    expect(plain).toContain('draft line')
  })

  it('Restore on boot loads the draft text as a recovered (dirty) document; a save deletes it', async () => {
    const p = await profile()
    const first = p.frame()
    const { text: original } = await open(first.api)
    first.api.provideText(() => `${original}restored\r\n`)
    first.api.setDirty(true)
    await first.flush()

    const second = p.frame('restore')
    const { text } = await open(second.api)
    expect(second.prompt).toHaveBeenCalledOnce()
    expect(text).toBe(`${original}restored\r\n`)
    expect(second.api.consumeRecovered()).toBe(original)
    expect(second.api.consumeRecovered()).toBeNull()

    second.api.setDirty(true)
    expect(await second.api.save({ text, imageSources: [], mode: 'save' })).toMatchObject({
      ok: true,
    })
    await vi.waitFor(() => expect(p.records().size).toBe(0))
  })

  it('Discard keeps the server text and deletes the draft', async () => {
    const p = await profile()
    const first = p.frame()
    const { text: original } = await open(first.api)
    first.api.provideText(() => 'lost edits')
    first.api.setDirty(true)
    await first.flush()

    const second = p.frame('discard')
    const { text } = await open(second.api)
    expect(second.prompt).toHaveBeenCalledOnce()
    expect(text).toBe(original)
    expect(second.api.consumeRecovered()).toBeNull()
    expect(p.records().size).toBe(0)
  })

  it('a view-only document is never drafted', async () => {
    const p = await profile()
    const f = p.frame('restore', { print: true })
    await open(f.api)
    f.api.provideText(() => 'x')
    f.api.setDirty(true)
    await f.flush()
    expect(p.records().size).toBe(0)
  })
})
