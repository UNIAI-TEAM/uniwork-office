// @vitest-environment jsdom
// GO-B4 P-1/P-3/P-5: window.pdfApi of the web frame over a mocked protocol port (the pattern of
// web/docs/bridge/webapi.test.ts). The save core is a fake here (bytes in -> marked bytes out);
// the real core runs in save-core.golden.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SavePdfRequest } from '../../../apps/pdf/src/shared/ipc'
import { createMockPort, protocolError, type MockPort } from '../../docs/bridge/testing/mock-port'
import {
  DRAFTS_DB,
  DRAFTS_STORE,
  createDraftRecovery,
  createIdbDraftStore,
  decryptDraft,
  encryptDraft,
  type DraftChoice,
  type DraftInfo,
  type DraftRecord,
  type DraftRecovery,
} from '../../docs/bridge/draft-recovery'
import { setWebLanguage, webLanguage } from '../../docs/bridge/browser'
import { webText } from '../shared/i18n/strings-web'
import { createFakeIdb } from '../../docs/bridge/testing/fake-idb'
import type { PdfCore } from './core'
import { createSignatureStore } from './signatures'
import { createPdfWebApi, nameFromSaveAsTarget, pathFor, saveAsTarget } from './webapi'

const PDF = (s: string) => new TextEncoder().encode(`%PDF-1.7 ${s}`)
const str = (b: ArrayBuffer | Uint8Array) => new TextDecoder().decode(b)

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

function fakeCore(): PdfCore & { calls: string[] } {
  const calls: string[] = []
  const tag = (name: string) => async (bytes: Uint8Array) => {
    calls.push(name)
    return new TextEncoder().encode(`${str(bytes)}+${name}`)
  }
  return {
    calls,
    applyAndVerifySaveRequest: async (bytes, request) => {
      calls.push('save')
      return {
        bytes: new TextEncoder().encode(`${str(bytes)}+m${request.markups.length}`),
        skippedTextEdits: [],
        skippedTextInserts: [],
        skippedImageEdits: [],
      }
    },
    readStaticFormFills: async () => [],
    extractPagesBytes: tag('extract'),
    insertPdfBytes: async (bytes, other) => ({
      merged: new TextEncoder().encode(`${str(bytes)}+insert(${str(other)})`),
      count: 1,
    }),
    insertBlankPageBytes: tag('blank'),
    splitPdfBytes: async (bytes) => [bytes, bytes],
    mergePdfBytes: async (bytes, others) => ({
      merged: new TextEncoder().encode(`${str(bytes)}+merge${others.length}`),
      appended: others.length,
    }),
    mergePagesBytes: tag('nup'),
    replacePagesBytes: async (bytes) => ({ merged: bytes, removed: 1, inserted: 1 }),
    setPageSizeBytes: tag('size'),
    splitPagesBytes: tag('splitPages'),
    cropPagesBytes: tag('crop'),
    validateTextEdits: async () => [],
    listEditFonts: () => ['arial'],
    canDrawText: () => true,
    listPageImages: async () => [],
    renderImagePng: async () => null,
    renderPagePreviewPng: async () => null,
    blankPdfBuffer: async () => Buffer.from(PDF('blank')),
  } as PdfCore & { calls: string[] }
}

const req = (path: string, over: Partial<SavePdfRequest> = {}): SavePdfRequest => ({
  path,
  markups: [],
  drawings: [],
  formValues: [],
  stamps: [],
  ...over,
})

interface Setup {
  mock: MockPort
  api: ReturnType<typeof createPdfWebApi>['api']
  core: ReturnType<typeof fakeCore>
  caps: Record<string, unknown>
  downloads: Array<{ name: string; data: Blob }>
  zips: Array<Array<{ name: string; data: Uint8Array }>>
  fileId: string
  ensureFonts: ReturnType<typeof vi.fn>
}

async function setup(
  opts: { caps?: Record<string, unknown>; viaInitOpen?: boolean; user?: string } = {},
): Promise<Setup> {
  const mock = createMockPort()
  const meta = mock.seed('Report.pdf', PDF('v1'))
  const caps = { edit: true, insertPages: true, ...opts.caps }
  const core = fakeCore()
  const downloads: Setup['downloads'] = []
  const zips: Setup['zips'] = []
  const ensureFonts = vi.fn(async () => {})
  const { api } = createPdfWebApi(mock.port, {
    capabilities: caps,
    core: async () => core,
    ensureFonts,
    signatures: createSignatureStore({ idb: () => null, legacy: () => null }),
    download: (name, data) => downloads.push({ name, data }),
    zip: async (files) => {
      zips.push(files)
      return new Blob(['zip'])
    },
    saveTimeoutMs: 2000,
  })
  mock.init({
    documentId: meta.fileId,
    ...(opts.viaInitOpen ? { open: mock.openPayload(meta.fileId) } : {}),
    ...(opts.user ? { user: { displayName: opts.user } } : {}),
  })
  return { mock, api, core, caps, downloads, zips, fileId: meta.fileId, ensureFonts }
}

const choose = async (id: string) => {
  await vi.waitFor(() => expect(document.querySelector(`[data-choice="${id}"]`)).not.toBeNull())
  ;(document.querySelector(`[data-choice="${id}"]`) as HTMLButtonElement).click()
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('paths', () => {
  it('round-trips Save As targets and file paths', () => {
    expect(pathFor({ fileId: 'f1', name: 'A b.pdf' })).toBe('uniwork://files/f1/A b.pdf')
    expect(nameFromSaveAsTarget(saveAsTarget('Bản sao/x.pdf'))).toBe('Bản sao/x.pdf')
  })
})

describe('open and the working copy', () => {
  it('boots from init.open, reads a copy of the bytes, refuses other paths', async () => {
    const s = await setup({ viaInitOpen: true, user: 'Test User' })
    const path = await s.api.consumePending()
    expect(path).toBe(`uniwork://files/${s.fileId}/Report.pdf`)
    expect(s.mock.titles).toContain('Report.pdf')
    expect(s.mock.calls.filter((c) => c.type === 'api.open')).toHaveLength(0)
    const a = await s.api.readFile(path!)
    new Uint8Array(a).fill(0) // pdf.js may detach / reuse what it gets
    expect(str(await s.api.readFile(path!))).toBe('%PDF-1.7 v1')
    await expect(s.api.readFile('uniwork://files/other/x.pdf')).rejects.toThrow(/not granted/)
    expect(await s.api.getUsername()).toBe('Test User')
  })

  it('an empty new file opens as the blank PDF page', async () => {
    const mock = createMockPort()
    const meta = mock.seed('Untitled.pdf', new Uint8Array())
    const { api } = createPdfWebApi(mock.port, {
      capabilities: { edit: true },
      core: async () => fakeCore(),
      ensureFonts: async () => {},
    })
    mock.init({ documentId: meta.fileId })
    const path = (await api.consumePending())!
    expect(str(await api.readFile(path))).toBe('%PDF-1.7 blank')
  })

  it('boots through api.open when init carries no document', async () => {
    const s = await setup()
    expect(await s.api.consumePending()).toBe(`uniwork://files/${s.fileId}/Report.pdf`)
    expect(s.mock.calls.some((c) => c.type === 'api.open')).toBe(true)
    expect(await s.api.getUsername()).toBe('')
  })

  it('a failed open is fatal: notice, error event, no saves', async () => {
    const mock = createMockPort()
    const { api } = createPdfWebApi(mock.port, {
      capabilities: { edit: true },
      core: async () => fakeCore(),
      ensureFonts: async () => {},
    })
    mock.override('api.open', () => Promise.reject(protocolError('too_large', 'over 64 MiB')))
    mock.init({ documentId: 'nope' })
    expect(await api.consumePending()).toBeNull()
    expect(mock.errors[0]?.fatal).toBe(true)
    expect(document.querySelector('[data-pdf-web="fatal"]')).not.toBeNull()
    const r = await api.save(req('uniwork://files/nope/x.pdf'))
    expect(r.ok).toBe(false)
  })

  it('a host `open` while running asks the viewer to reload the new document', async () => {
    const s = await setup()
    await s.api.consumePending()
    const reloads: string[] = []
    s.api.onReloadRequest((p) => reloads.push(p))
    const other = s.mock.seed('Other.pdf', PDF('other'))
    await s.mock.host.open(s.mock.openPayload(other.fileId))
    await flush()
    expect(reloads).toEqual([`uniwork://files/${other.fileId}/Other.pdf`])
    expect(str(await s.api.readFile(reloads[0]!))).toBe('%PDF-1.7 other')
  })
})

describe('save', () => {
  it('runs the core on the working copy, uploads with the etag, advances the working copy', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    const r = await s.api.save(req(path, { markups: [{} as never] }))
    expect(r).toEqual({ ok: true })
    const call = s.mock.calls.find((c) => c.type === 'api.save')!
    const payload = call.payload as {
      fileId: string
      data: ArrayBuffer
      etag?: string
      auto?: boolean
    }
    expect(payload.etag).toBe(`"${s.fileId}-v1"`)
    expect('auto' in payload).toBe(false) // no autosave on the web (CONTRACT C10)
    expect(str(s.mock.bytesOf(s.fileId)!)).toBe('%PDF-1.7 v1+m1')
    expect(str(await s.api.readFile(path))).toBe('%PDF-1.7 v1+m1')
    expect(s.mock.saved.at(-1)).toMatchObject({ initiatedByFrame: true, versionId: 'v2' })
    // the next save sends the new etag
    await s.api.save(req(path))
    const second = s.mock.calls.filter((c) => c.type === 'api.save')[1]!.payload as {
      etag?: string
    }
    expect(second.etag).toBe(`"${s.fileId}-v2"`)
  })

  it('a failed save reads in the UI language, never the raw browser error', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.mock.override('api.save', () => ({
      ok: false,
      error: { code: 'network', message: 'Failed to fetch' },
    }))
    expect(await s.api.save(req(path, { markups: [{} as never] }))).toEqual({
      ok: false,
      error: 'UniWork could not be reached. Check your connection and try again.',
    })
    s.mock.override('api.save', () => ({
      ok: false,
      error: { code: 'timeout', message: 'save timed out' },
    }))
    expect(await s.api.save(req(path, { markups: [{} as never] }))).toEqual({
      ok: false,
      error: 'Saving took too long. Check your connection and try again.',
    })
  })

  it('a server error reads in the UI language, never the host status line', async () => {
    setWebLanguage('vi', { host: true })
    const s = await setup()
    const path = (await s.api.consumePending())!
    for (const [code, status, raw] of [
      ['internal', 500, 'Internal Server Error'],
      ['forbidden', 403, 'Forbidden'],
      ['not_found', 404, 'Not Found'],
      ['too_large', 413, 'Payload Too Large'],
    ] as const) {
      s.mock.override('api.save', () => ({ ok: false, error: { code, message: raw, status } }))
      const r = await s.api.save(req(path, { markups: [{} as never] }))
      expect(r.ok).toBe(false)
      expect((r as { error: string }).error).not.toContain(raw)
      expect((r as { error: string }).error).toMatch(/UniWork|Bạn|tài liệu|lưu/i)
    }
    setWebLanguage('en', { host: true })
  })

  it('text edits fetch the bundled fonts first', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    await s.api.save(req(path, { textEdits: [{} as never] }))
    expect(s.ensureFonts).toHaveBeenCalled()
  })

  it('a core failure (e.g. verification) is a failed save, nothing uploaded', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.core.applyAndVerifySaveRequest = async () => {
      throw new Error('save-verify-failed pages=1: x; the file was not written')
    }
    const r = await s.api.save(req(path))
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^save-verify-failed/) })
    expect(s.mock.calls.some((c) => c.type === 'api.save')).toBe(false)
  })

  it('view-only (no save grant): every write path is refused', async () => {
    const s = await setup({ caps: { edit: false } })
    const path = (await s.api.consumePending())!
    expect((await s.api.save(req(path))).ok).toBe(false)
    expect((await s.api.insertBlankPage({ path, afterPageIndex: 0 })).ok).toBe(false)
    expect(((await s.mock.host.save({ reason: 'user' })) as { ok: boolean }).ok).toBe(false)
    expect(s.mock.calls.some((c) => c.type === 'api.save')).toBe(false)
    expect(s.core.calls).toEqual([])
  })

  // M-01 (post-A9 sweep): the same view-only answer the other modules give the AI panel
  it('uniworkState reports readOnly when the frame grants no edit', async () => {
    const view = await setup({ caps: { edit: false } })
    await view.api.consumePending()
    expect(await view.api.uniworkState('x.pdf')).toEqual({ bound: false, readOnly: true })
    const edit = await setup()
    await edit.api.consumePending()
    expect(await edit.api.uniworkState('x.pdf')).toEqual({ bound: false, readOnly: false })
  })

  it('conflict -> Overwrite re-reads the head etag and saves again', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.mock.bumpRemote(s.fileId)
    const pending = s.api.save(req(path))
    await choose('overwrite')
    await choose('go')
    expect(await pending).toEqual({ ok: true })
    expect(s.mock.errors.some((e) => (e.error as { code?: string }).code === 'conflict')).toBe(true)
    expect(str(s.mock.bytesOf(s.fileId)!)).toBe('%PDF-1.7 v1+m0')
  })

  it('conflict -> Reload latest replaces the working copy and asks the viewer to reopen', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    const reloads: string[] = []
    s.api.onReloadRequest((p) => reloads.push(p))
    s.mock.commit(s.fileId, PDF('theirs'))
    const pending = s.api.save(req(path))
    await choose('reload')
    await choose('discard')
    const r = await pending
    expect(r.ok).toBe(false)
    await flush()
    expect(reloads).toEqual([path])
    expect(str(await s.api.readFile(path))).toBe('%PDF-1.7 theirs')
  })

  it('conflict -> Cancel keeps the server version', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.mock.commit(s.fileId, PDF('theirs'))
    const pending = s.api.save(req(path))
    await choose('cancel')
    expect((await pending).ok).toBe(false)
    expect(str(s.mock.bytesOf(s.fileId)!)).toBe('%PDF-1.7 theirs')
  })

  it('host `save` runs the viewer save flow; its conflict opens the frame dialog, Cancel answers cancelled', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.api.onCloseSaveRequest(() => {
      void s.api.save(req(path)).then((r) => s.api.sendCloseSaveResult(r.ok))
    })
    const ok = (await s.mock.host.save({ reason: 'navigate' })) as {
      ok: boolean
      file?: { versionId?: string }
    }
    expect(ok).toMatchObject({ ok: true, file: { versionId: 'v2' } })
    expect(s.mock.saved.at(-1)?.initiatedByFrame).toBe(false)

    s.mock.bumpRemote(s.fileId)
    const res = s.mock.host.save({ reason: 'user' })
    await choose('cancel')
    expect(await res).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(document.querySelector('[data-pdf-web="conflict"]')).toBeNull()
    expect(s.mock.errors).toHaveLength(0)
  })

  it('host `save` conflict: DOM order and first focus, Overwrite… confirmed answers the new version', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.api.onCloseSaveRequest(() => {
      void s.api.save(req(path)).then((r) => s.api.sendCloseSaveResult(r.ok))
    })
    s.mock.bumpRemote(s.fileId)
    const res = s.mock.host.save({ reason: 'user' })
    await vi.waitFor(() =>
      expect(document.querySelector('[data-pdf-web="conflict"] [data-choice]')).not.toBeNull(),
    )
    expect(
      [...document.querySelectorAll('[data-choice]')].map((b) => (b as HTMLElement).dataset.choice),
    ).toEqual(['reload', 'overwrite', 'cancel'])
    expect((document.activeElement as HTMLElement).dataset.choice).toBe('cancel')
    await choose('overwrite')
    await choose('go')
    expect(await res).toMatchObject({ ok: true, versionId: 'v3' })
  })

  it('host `save` conflict -> Reload answers ok without a versionId; download only with the capability', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.api.onCloseSaveRequest(() => {
      void s.api.save(req(path)).then((r) => s.api.sendCloseSaveResult(r.ok))
    })
    s.mock.bumpRemote(s.fileId)
    const res = s.mock.host.save({ reason: 'navigate' })
    await choose('reload')
    await vi.waitFor(() => expect(document.querySelector('[data-choice="discard"]')).not.toBeNull())
    expect(document.querySelector('[data-choice="download"]')).toBeNull()
    await choose('discard')
    const answer = await res
    expect(answer).toMatchObject({ ok: true, file: { versionId: 'v2' } })
    expect(answer).not.toHaveProperty('versionId')
  })

  it('a host `save` conflict reads as a conflict in the viewer, never the server message or "try again"', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    let failure = ''
    s.api.onCloseSaveRequest(() => {
      void s.api.save(req(path)).then((r) => {
        failure = r.ok ? '' : String(r.error)
        s.api.sendCloseSaveResult(r.ok)
      })
    })
    s.mock.bumpRemote(s.fileId)
    const res = s.mock.host.save({ reason: 'user' })
    await choose('cancel')
    await res
    await vi.waitFor(() => expect(failure).not.toBe(''))
    expect(failure).toBe('the document was changed elsewhere')
    expect(failure).not.toMatch(/try again|stale etag|409/i)
  })

  it('doc.closeCheck mirrors the viewer dirty flag; autosave is never claimed', async () => {
    const s = await setup()
    await s.api.consumePending()
    s.api.setDirty(true)
    expect(s.mock.dirty.at(-1)).toBe(true)
    expect(await s.mock.host['doc.closeCheck']({})).toEqual({ dirty: true, autoSave: false })
  })
})

describe('Save As', () => {
  it('host saveAs -> the viewer writes a copy through api.saveAs; the original stays open', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.api.onSaveAsRequest((target) => {
      void s.api
        .save(req(path, { targetPath: target, markups: [{} as never] }))
        .then((r) => s.api.sendSaveAsResult(r.ok))
    })
    const res = (await s.mock.host.saveAs({ name: 'Copy' })) as {
      ok: boolean
      file?: { name: string }
    }
    expect(res).toMatchObject({ ok: true, file: { name: 'Copy.pdf' } })
    const call = s.mock.calls.find((c) => c.type === 'api.saveAs')!.payload as {
      name: string
      sourceFileId: string
    }
    expect(call).toMatchObject({ name: 'Copy.pdf', sourceFileId: s.fileId })
    // the working copy and the open document are unchanged (desktop: original never mutated)
    expect(str(await s.api.readFile(path))).toBe('%PDF-1.7 v1')
    expect(str(s.mock.bytesOf(s.fileId)!)).toBe('%PDF-1.7 v1')
  })

  it('no viewer listening -> not_ready', async () => {
    const s = await setup()
    await s.api.consumePending()
    expect(await s.mock.host.saveAs({})).toMatchObject({ ok: false, error: { code: 'not_ready' } })
  })
})

describe('page operations', () => {
  it('in-place ops upload a new version; the viewer re-reads it', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    expect(await s.api.insertBlankPage({ path, afterPageIndex: 0 })).toEqual({ ok: true })
    expect(await s.api.setPageSize({ path, width: 595, height: 842 })).toEqual({ ok: true })
    expect(await s.api.cropPages({ path, pages: [0], rect: { l: 0, t: 0, r: 1, b: 1 } })).toEqual({
      ok: true,
    })
    expect(str(await s.api.readFile(path))).toBe('%PDF-1.7 v1+blank+size+crop')
    expect(s.mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(3)
  })

  it('import pages picks a PDF in the host (purpose insert)', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.mock.seed('Extra.pdf', PDF('extra'))
    const r = await s.api.insertPdf({ path, afterPageIndex: 0 })
    expect(r).toEqual({ ok: true, insertedCount: 1 })
    expect(s.mock.calls.find((c) => c.type === 'file.pick')?.payload).toEqual({
      purpose: 'insert',
      accept: ['pdf'],
    })
    expect(str(s.mock.bytesOf(s.fileId)!)).toBe('%PDF-1.7 v1+insert(%PDF-1.7 extra)')
  })

  it('a cancelled pick changes nothing; without the filePick grant import is refused', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.mock.override('file.pick', () => ({ file: null }))
    expect(await s.api.insertPdf({ path, afterPageIndex: 0 })).toEqual({ ok: true, canceled: true })
    s.caps.insertPages = false
    expect((await s.api.insertPdf({ path, afterPageIndex: 0 })).ok).toBe(false)
    expect(s.mock.calls.some((c) => c.type === 'api.save')).toBe(false)
  })

  it('merge: repeated single picks, then one download', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    s.mock.seed('B.pdf', PDF('b'))
    const pending = s.api.mergePdf({ path, suggestedName: 'Report-merged.pdf' })
    await choose('add')
    await choose('merge')
    expect(await pending).toEqual({ ok: true, savedPath: 'Report-merged.pdf', appendedCount: 2 })
    expect(s.mock.calls.filter((c) => c.type === 'file.pick')).toHaveLength(2)
    expect(s.downloads.map((d) => d.name)).toEqual(['Report-merged.pdf'])
    expect(s.mock.calls.some((c) => c.type === 'api.save')).toBe(false)
  })

  it('new files are downloads: extract one PDF, split / export several as a zip', async () => {
    const s = await setup()
    const path = (await s.api.consumePending())!
    expect(await s.api.extractPages({ path, pages: [0], suggestedName: 'Report-p1.pdf' })).toEqual({
      ok: true,
      savedPath: 'Report-p1.pdf',
    })
    expect(await s.api.splitPdf({ path, chunkSize: 1, baseName: 'Report' })).toEqual({
      ok: true,
      savedDir: 'Report.zip',
      count: 2,
    })
    expect(s.zips[0]!.map((f) => f.name)).toEqual(['Report-1.pdf', 'Report-2.pdf'])
    const png = btoa('png')
    expect(
      await s.api.exportImages({ images: [png, png], pageNumbers: [1, 2], baseName: 'Report' }),
    ).toEqual({ ok: true, savedDir: 'Report-images.zip', count: 2 })
    expect(s.downloads.map((d) => d.name)).toEqual([
      'Report-p1.pdf',
      'Report.zip',
      'Report-images.zip',
    ])
  })
})

describe('print and hidden members', () => {
  it('host print opens the viewer print dialog; mode pdf downloads the document', async () => {
    const s = await setup()
    await s.api.consumePending()
    const opened = vi.fn()
    s.api.onPrintRequest(opened)
    expect(await s.mock.host.print({ mode: 'dialog' })).toEqual({ printed: true })
    expect(opened).toHaveBeenCalledOnce()
    expect(await s.mock.host.print({ mode: 'pdf' })).toEqual({ printed: true })
    expect(s.downloads.map((d) => d.name)).toEqual(['Report.pdf'])
  })

  it('desktop-only members answer safe values', async () => {
    const s = await setup()
    expect(await s.api.ocrPage('x')).toBeNull()
    expect(await s.api.autoRename('p', 'n')).toEqual({ renamed: false })
    expect(await s.api.isUntitled('p')).toBe(false)
    expect(await s.api.consumeAiPreset()).toBeNull()
    expect(typeof s.api.onAiPreset(() => {})).toBe('function')
    expect((await s.api.createDocument({} as never)).ok).toBe(false)
    expect(await s.api.gskStatus()).toEqual({ loggedIn: false })
    expect(await s.api.listEditFonts()).toEqual(['arial'])
  })
})

describe('draft recovery (C18)', () => {
  const recoveries: DraftRecovery[] = []
  afterEach(() => {
    for (const r of recoveries.splice(0)) r.dispose()
  })

  async function draftSetup(opts: { answer?: DraftChoice; draft?: string } = {}) {
    const mock = createMockPort()
    const meta = mock.seed('Report.pdf', PDF('v1'))
    const fake = createFakeIdb()
    const store = createIdbDraftStore(fake.idb)
    const grant = {
      key: await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]),
      scope: `u1:${meta.fileId}`,
    }
    // a draft left by an earlier frame load (another tab id)
    const recordKey = `${grant.scope}:${meta.etag}:oldtab`
    if (opts.draft !== undefined) {
      const { iv, ciphertext } = await encryptDraft(grant.key, recordKey, PDF(opts.draft))
      await store.put(recordKey, {
        iv,
        ciphertext,
        baseEtag: meta.etag ?? '',
        savedAt: 1,
        module: 'pdf',
        name: 'Report.pdf',
      })
    }
    const prompt = vi.fn(async (_d: DraftInfo) => opts.answer ?? 'restore')
    let recovery!: DraftRecovery
    const core = fakeCore()
    const { api } = createPdfWebApi(mock.port, {
      capabilities: { edit: true },
      core: async () => core,
      ensureFonts: async () => {},
      signatures: createSignatureStore({ idb: () => null, legacy: () => null }),
      drafts: (host) => {
        recovery = createDraftRecovery({
          module: 'pdf',
          recovery: () => grant,
          host,
          prompt,
          store,
        })
        recoveries.push(recovery)
        return recovery
      },
    })
    mock.init({ documentId: meta.fileId })
    const records = () => fake.store(DRAFTS_DB, DRAFTS_STORE) ?? new Map<string, unknown>()
    const decrypted = async () => {
      const [entry] = [...records()]
      if (!entry) return null
      const [key, record] = entry as [string, DraftRecord]
      return str((await decryptDraft(grant.key, key, record))!)
    }
    return { mock, api, core, meta, prompt, recovery: () => recovery, records, decrypted }
  }

  it('writes the encrypted working copy + pending edits while dirty, never api.save', async () => {
    const s = await draftSetup()
    const path = (await s.api.consumePending())!
    expect(s.prompt).not.toHaveBeenCalled()
    s.api.provideSaveRequest(() => req(path, { markups: [{} as never] }))
    await s.recovery().flush()
    expect(s.records().size).toBe(0) // clean: nothing kept
    s.api.setDirty(true)
    await s.recovery().flush()
    expect(await s.decrypted()).toBe('%PDF-1.7 v1+m1')
    const raw = s.records().values().next().value as DraftRecord
    expect(str(raw.ciphertext)).not.toContain('PDF')
    expect(s.mock.calls.some((c) => c.type === 'api.save')).toBe(false)
    expect(s.mock.saved).toHaveLength(0)
  })

  it('Restore serves the draft bytes as a recovered, dirty document; Save writes them', async () => {
    const s = await draftSetup({ draft: 'draft' })
    const path = (await s.api.consumePending())!
    expect(s.prompt).toHaveBeenCalledTimes(1)
    expect(str(await s.api.readFile(path))).toBe('%PDF-1.7 draft')
    expect(s.api.consumeRecovered()).toBe(true)
    expect(s.api.consumeRecovered()).toBe(false) // one-shot
    // the renderer has no pending edits yet: the frame stays dirty
    s.api.setDirty(false)
    expect(s.mock.dirty.at(-1)).toBe(true)
    expect(await s.mock.host['doc.closeCheck']({})).toEqual({ dirty: true, autoSave: false })
    // an empty edit request still writes the restored bytes, If-Match = the head etag
    expect(await s.api.save(req(path))).toEqual({ ok: true })
    const put = s.mock.calls.find((c) => c.type === 'api.save')!
    expect(put.payload).toMatchObject({ fileId: s.meta.fileId, etag: s.meta.etag })
    expect(str((put.payload as { data: ArrayBuffer }).data)).toBe('%PDF-1.7 draft+m0')
    // a landed save deletes the scope's drafts and ends the recovered state
    await vi.waitFor(() => expect(s.records().size).toBe(0))
    expect(await s.mock.host['doc.closeCheck']({})).toEqual({ dirty: false, autoSave: false })
  })

  it('Discard serves the server bytes and deletes the draft', async () => {
    const s = await draftSetup({ draft: 'draft', answer: 'discard' })
    const path = (await s.api.consumePending())!
    expect(s.prompt).toHaveBeenCalledTimes(1)
    expect(str(await s.api.readFile(path))).toBe('%PDF-1.7 v1')
    expect(s.api.consumeRecovered()).toBe(false)
    expect(await s.mock.host['doc.closeCheck']({})).toEqual({ dirty: false, autoSave: false })
    expect(s.records().size).toBe(0)
  })

  it('a save of edited bytes deletes the stored draft', async () => {
    const s = await draftSetup()
    const path = (await s.api.consumePending())!
    s.api.provideSaveRequest(() => req(path, { markups: [{} as never] }))
    s.api.setDirty(true)
    await s.recovery().flush()
    expect(s.records().size).toBe(1)
    expect(await s.api.save(req(path, { markups: [{} as never] }))).toEqual({ ok: true })
    await vi.waitFor(() => expect(s.records().size).toBe(0))
  })
})

describe('openInApp (A7: the "use the app" action)', () => {
  it('asks the host once, with the feature tag and no timeout, only with the desktopOpen grant', async () => {
    const t = await setup({ caps: { desktopOpen: true } })
    t.mock.override('app.open', () => ({ outcome: 'launched' }))
    expect(await t.api.openInApp('pdf.ocr')).toEqual({ outcome: 'launched' })
    const calls = t.mock.calls.filter((c) => c.type === 'app.open')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.payload).toEqual({ feature: 'pdf.ocr' })
    expect(calls[0]!.opts?.timeoutMs).toBe(0)
  })

  it('without the grant nothing is sent', async () => {
    const t = await setup({ caps: { desktopOpen: false } })
    expect(await t.api.openInApp('pdf.convert')).toEqual({ outcome: 'unavailable' })
    expect(t.mock.calls.filter((c) => c.type === 'app.open')).toHaveLength(0)
  })

  it('the grant is read at call time (init lands after the api is built)', async () => {
    const t = await setup({ caps: { desktopOpen: false } })
    t.caps.desktopOpen = true
    expect(await t.api.openInApp()).toEqual({ outcome: 'launched' })
  })
})

// G5-03w: a newer version saved elsewhere (doc.remoteVersion)
describe('new version on UniWork (doc.remoteVersion)', () => {
  const event = (fileId: string, revision: string) => ({
    document_id: fileId,
    revision,
    version_id: `v${revision}`,
    saved_at: new Date(Date.UTC(2026, 9, 12, 8)).toISOString(),
    author_name: 'Trần An',
  })
  const barText = () => document.querySelector('.uw-remote-bar-text')?.textContent ?? null
  /** a viewer that opened the document at revision 10, so a revision 12 event is newer */
  async function bootAt10() {
    const mock = createMockPort()
    const meta = mock.seed('Report.pdf', PDF('v1'))
    const { api } = createPdfWebApi(mock.port, {
      capabilities: { edit: true },
      core: async () => fakeCore(),
      ensureFonts: async () => {},
      signatures: createSignatureStore({ idb: () => null, legacy: () => null }),
      download: () => {},
      saveTimeoutMs: 2000,
    })
    mock.init({
      documentId: meta.fileId,
      open: { ...mock.openPayload(meta.fileId), file: { ...meta, revision: '10' } },
    })
    await api.consumePending()
    return { mock, meta, api }
  }

  it('clean: the head is read through api.open and the viewer reloads it in place', async () => {
    const { mock, meta, api } = await bootAt10()
    const reloads: string[] = []
    api.onReloadRequest((p) => reloads.push(p))
    api.setDirty(false)
    mock.commit(meta.fileId, PDF('head'))
    mock.override('api.open', (payload) => {
      const open = mock.openPayload((payload as { fileId: string }).fileId)
      return { ...open, file: { ...open.file, revision: '12', versionId: 'v12' } }
    })
    mock.sendRemoteVersion(event(meta.fileId, '12'))
    await vi.waitFor(() => expect(reloads).toHaveLength(1))
    expect(str(await api.readFile(reloads[0]!))).toBe('%PDF-1.7 head')
    expect(mock.calls.filter((c) => c.type === 'api.open').at(-1)!.payload).toEqual({
      fileId: meta.fileId,
      versionId: 'v12',
    })
    expect(barText()).toContain('12')
  })

  it('dirty: the viewer keeps its copy and the warn bar shows', async () => {
    const { mock, meta, api } = await bootAt10()
    const reloads: string[] = []
    api.onReloadRequest((p) => reloads.push(p))
    api.setDirty(true)
    mock.sendRemoteVersion(event(meta.fileId, '12'))
    await vi.waitFor(() => expect(barText()).toContain('12'))
    expect(reloads).toEqual([])
    expect(document.querySelector('[data-action="reload"]')).not.toBeNull()
  })

  it('doc.blocked locks at once on a dirty viewer: the bar, the host save refused, no reload', async () => {
    const { mock, meta, api } = await bootAt10()
    const reloads: string[] = []
    api.onReloadRequest((p) => reloads.push(p))
    api.setDirty(true)
    mock.sendBlocked({ document_id: meta.fileId, reason: 'permission_revoked' })
    expect(document.querySelector('.uw-remote-bar--error')).not.toBeNull()
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(0)
    expect(reloads).toEqual([])
  })

  it('doc.blocked with an organisation reason: the bar only, the viewer usable, Save still reaches the host', async () => {
    const { mock, meta, api } = await bootAt10()
    api.setDirty(true)
    mock.sendBlocked({ document_id: meta.fileId, reason: 'organization_suspended' })
    expect(document.querySelector('.uw-remote-bar--error')).not.toBeNull()
    expect(barText()).toBe(
      webText(webLanguage(), 'uwRemoteOrgBlockedWeb', {
        reason: webText(webLanguage(), 'uwReasonSuspended'),
      }),
    )
    expect(await api.save(req(pathFor(meta), { markups: [{} as never] }))).toEqual({
      ok: true,
    })
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(1)
  })
})

describe('pdfApi: save size gate (SIZE-F1, UNI-1861)', () => {
  it('blocks save and saveAs above limits.max_bytes without api.save / api.saveAs', async () => {
    const mock = createMockPort()
    const meta = mock.seed('Report.pdf', PDF('v1'))
    const api = createPdfWebApi(mock.port, {
      capabilities: { edit: true },
      core: async () => fakeCore(),
      ensureFonts: async () => {},
      signatures: createSignatureStore({ idb: () => null, legacy: () => null }),
    }).api
    // init.open carries the limits like a real host (D §3.2)
    mock.init({
      documentId: meta.fileId,
      open: {
        ...mock.openPayload(meta.fileId),
        limits: { max_bytes: 12, warn_ratio: 0.5 },
      },
    })
    const path = (await api.consumePending())!

    // '%PDF-1.7 v1+m0' is 14 bytes > 12 B max_bytes -> blocked before api.save
    const res = await api.save(req(path))
    expect(res).toEqual({ ok: false, error: '' })
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(0)
    expect(mock.saveBlocked).toHaveLength(1)

    const resAs = await api.save(req(path, { targetPath: 'uniwork://save-as/Copy.pdf' }))
    expect(resAs).toEqual({ ok: false, error: '' })
    expect(mock.calls.filter((c) => c.type === 'api.saveAs')).toHaveLength(0)
    expect(mock.saveBlocked).toHaveLength(2)

    // Host-initiated save settles with too_large error
    api.onCloseSaveRequest(() => {
      void api.save(req(path)).then((r) => api.sendCloseSaveResult(r.ok))
    })
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'too_large' },
    })
  })
})

describe('FRAME-RO-01: capability flags and readOnly profile (UNI-1876)', () => {
  it('save: false with saveAs: true refuses in-place save and allows Save As and new-file exports', async () => {
    const s = await setup({ caps: { edit: false, save: false, saveAs: true } })
    const path = (await s.api.consumePending())!
    expect(await s.api.uniworkState(path)).toEqual({ bound: false, readOnly: true })
    expect((await s.api.save(req(path))).ok).toBe(false)
    expect(await s.mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'unsupported' },
    })
    expect(s.mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(0)

    s.api.onSaveAsRequest((target) => {
      void s.api
        .save(req(path, { targetPath: target, markups: [{} as never] }))
        .then((r) => s.api.sendSaveAsResult(r.ok))
    })
    const res = (await s.mock.host.saveAs({ name: 'Copy' })) as {
      ok: boolean
      file?: { name: string }
    }
    expect(res).toMatchObject({ ok: true, file: { name: 'Copy.pdf' } })
    expect(s.mock.calls.filter((c) => c.type === 'api.saveAs')).toHaveLength(1)

    expect(await s.api.extractPages({ path, pages: [0], suggestedName: 'Report-p1.pdf' })).toEqual({
      ok: true,
      savedPath: 'Report-p1.pdf',
    })
  })

  it('save: true with saveAs: false allows in-place save and refuses Save As and new-file exports (D2)', async () => {
    const s = await setup({ caps: { edit: true, save: true, saveAs: false } })
    const path = (await s.api.consumePending())!
    expect(await s.api.uniworkState(path)).toEqual({ bound: false, readOnly: false })

    expect(await s.api.save(req(path, { markups: [{} as never] }))).toEqual({ ok: true })
    expect(s.mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(1)

    expect(await s.api.save(req(path, { targetPath: 'uniwork://save-as/Copy.pdf' }))).toEqual({
      ok: false,
      error: 'unsupported: saveAs is not granted',
    })
    expect(await s.mock.host.saveAs({ name: 'Copy' })).toMatchObject({
      ok: false,
      error: { code: 'unsupported' },
    })
    expect(await s.api.extractPages({ path, pages: [0], suggestedName: 'Report-p1.pdf' })).toEqual({
      ok: false,
      error: 'unsupported: saveAs is not granted',
    })
    expect(await s.api.splitPdf({ path, chunkSize: 1, baseName: 'Report' })).toEqual({
      ok: false,
      error: 'unsupported: saveAs is not granted',
    })
    expect(await s.api.mergePdf({ path, suggestedName: 'Report-merged.pdf' })).toEqual({
      ok: false,
      error: 'unsupported: saveAs is not granted',
    })
    expect(
      await s.api.mergePages({
        path,
        perSheet: 2,
        direction: 'vertical',
        separator: false,
        suggestedName: 'Report-2in1.pdf',
      }),
    ).toEqual({
      ok: false,
      error: 'unsupported: saveAs is not granted',
    })
    expect(await s.api.splitPages({ path, perPage: 2, suggestedName: 'Report-split.pdf' })).toEqual(
      {
        ok: false,
        error: 'unsupported: saveAs is not granted',
      },
    )
    expect(
      await s.api.exportImages({ images: [btoa('png')], pageNumbers: [1], baseName: 'Report' }),
    ).toEqual({
      ok: false,
      error: 'unsupported: saveAs is not granted',
    })
    expect(s.downloads).toHaveLength(0)
    expect(s.mock.calls.filter((c) => c.type === 'api.saveAs')).toHaveLength(0)
  })

  it('print and exportPdf capabilities gate host print dialog vs pdf download independently', async () => {
    const noPrint = await setup({ caps: { print: false, exportPdf: true } })
    await noPrint.api.consumePending()
    const openedNoPrint = vi.fn()
    noPrint.api.onPrintRequest(openedNoPrint)
    expect(await noPrint.mock.host.print({ mode: 'dialog' })).toEqual({ printed: false })
    expect(openedNoPrint).not.toHaveBeenCalled()
    expect(await noPrint.mock.host.print({ mode: 'pdf' })).toEqual({ printed: true })
    expect(noPrint.downloads.map((d) => d.name)).toEqual(['Report.pdf'])

    const noPdf = await setup({ caps: { print: true, exportPdf: false } })
    await noPdf.api.consumePending()
    const openedNoPdf = vi.fn()
    noPdf.api.onPrintRequest(openedNoPdf)
    expect(await noPdf.mock.host.print({ mode: 'pdf' })).toEqual({ printed: false })
    expect(noPdf.downloads).toHaveLength(0)
    expect(await noPdf.mock.host.print({ mode: 'dialog' })).toEqual({ printed: true })
    expect(openedNoPdf).toHaveBeenCalledOnce()
  })

  it('readOnly profile clamps edit/save/saveAs/exportHtml off, refuses writes and Save As, and keeps granted print and exportPdf (D3)', async () => {
    const mock = createMockPort()
    const meta = mock.seed('Report.pdf', PDF('v1'))
    const caps: Record<string, unknown> = {
      edit: true,
      save: true,
      saveAs: true,
      insertPages: true,
      print: true,
      exportPdf: true,
      exportHtml: true,
    }
    const downloads: Array<{ name: string; data: Blob }> = []
    const { api } = createPdfWebApi(mock.port, {
      capabilities: caps,
      core: async () => fakeCore(),
      ensureFonts: async () => {},
      signatures: createSignatureStore({ idb: () => null, legacy: () => null }),
      download: (name, data) => downloads.push({ name, data }),
      saveTimeoutMs: 2000,
    })
    mock.init({
      profile: 'readOnly',
      documentId: meta.fileId,
      capabilities: {
        save: true,
        saveAs: true,
        print: true,
        exportPdf: true,
        exportHtml: true,
      },
    })
    const path = (await api.consumePending())!

    expect(await api.uniworkState(path)).toEqual({ bound: false, readOnly: true })
    expect(caps).toMatchObject({
      edit: false,
      save: false,
      saveAs: false,
      insertPages: false,
      exportHtml: false,
      print: true,
      exportPdf: true,
    })

    expect((await api.save(req(path))).ok).toBe(false)
    expect(await api.save(req(path, { targetPath: 'uniwork://save-as/Copy.pdf' }))).toEqual({
      ok: false,
      error: 'unsupported: saveAs is not granted',
    })
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'unsupported' },
    })
    expect(await mock.host.saveAs({ name: 'Copy' })).toMatchObject({
      ok: false,
      error: { code: 'unsupported' },
    })
    expect((await api.insertBlankPage({ path, afterPageIndex: 0 })).ok).toBe(false)
    expect(await api.extractPages({ path, pages: [0], suggestedName: 'Report-p1.pdf' })).toEqual({
      ok: false,
      error: 'unsupported: saveAs is not granted',
    })
    expect(mock.calls.filter((c) => c.type === 'api.save' || c.type === 'api.saveAs')).toHaveLength(
      0,
    )

    // D3: granted print and exportPdf stay available in readOnly profile
    const opened = vi.fn()
    api.onPrintRequest(opened)
    expect(await mock.host.print({ mode: 'dialog' })).toEqual({ printed: true })
    expect(opened).toHaveBeenCalledOnce()
    expect(await mock.host.print({ mode: 'pdf' })).toEqual({ printed: true })
    expect(downloads.map((d) => d.name)).toEqual(['Report.pdf'])
  })
})
