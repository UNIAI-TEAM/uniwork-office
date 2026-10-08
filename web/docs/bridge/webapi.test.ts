// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFileResult } from '../../../apps/docs/src/shared/ipc'
import { createWebApi, idFromPath, pathFor, WEB_PRINT_PART, type WebApi } from './webapi'
import { createMockPort, protocolError, timeoutAfter, type MockPort } from './testing/mock-port'

const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])
const flush = () => new Promise((r) => setTimeout(r, 0))

let mock: MockPort
let api: WebApi
let click: ReturnType<typeof vi.spyOn>

function setup(): void {
  mock = createMockPort()
  api = createWebApi(mock.port, { session: { pollMs: 0 } })
}

/** boot with one seeded document open, like the host's init would */
async function bootWith(name = 'Report.docx'): Promise<OpenFileResult> {
  const meta = mock.seed(name, DOCX)
  mock.init({ documentId: meta.fileId })
  return (await api.consumePendingOpenDocx()) as OpenFileResult
}

const buf = (bytes: number[]) => new Uint8Array(bytes).buffer

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
  window.print = vi.fn()
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  setup()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('paths', () => {
  it('round-trips file ids and rejects foreign paths', () => {
    const p = pathFor({ fileId: 'abc', name: 'A b.docx' })
    expect(p).toBe('uniwork://files/abc/A b.docx')
    expect(idFromPath(p)).toBe('abc')
    expect(idFromPath('/Users/x/a.docx')).toBeNull()
    expect(idFromPath(null)).toBeNull()
  })
})

describe('boot open (consumePendingOpenDocx)', () => {
  it('opens init.documentId through api.open once', async () => {
    const first = await bootWith()
    expect(first.name).toBe('Report.docx')
    expect(idFromPath(first.path)).toBe('f1')
    expect(new Uint8Array(first.data)).toEqual(DOCX)
    expect(first.hash).toMatch(/^[0-9a-f]{64}$|^$/)
    expect(mock.calls.map((c) => c.type)).toEqual(['api.open'])
    expect(await api.consumePendingOpenDocx()).toBeNull()
  })

  it('uses init.open without a round-trip', async () => {
    const meta = mock.seed('Inline.docx', DOCX)
    mock.init({ documentId: meta.fileId, open: mock.openPayload(meta.fileId) })
    const r = (await api.consumePendingOpenDocx()) as OpenFileResult
    expect(r.name).toBe('Inline.docx')
    expect(mock.calls).toHaveLength(0)
  })

  it('fetches a url source without cookies', async () => {
    const fetchMock = vi.fn(async () => new Response(DOCX.slice(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    mock.init({
      documentId: 'u1',
      open: { file: { fileId: 'u1', name: 'Url.docx' }, source: { kind: 'url', url: 'https://s3/signed' } },
    })
    const r = (await api.consumePendingOpenDocx()) as OpenFileResult
    expect(new Uint8Array(r.data)).toEqual(DOCX)
    expect(fetchMock).toHaveBeenCalledWith('https://s3/signed', { credentials: 'omit', headers: undefined })
    vi.unstubAllGlobals()
  })

  it('error: reports a fatal error to the host and opens nothing', async () => {
    mock.init({ documentId: 'nope' })
    expect(await api.consumePendingOpenDocx()).toBeNull()
    expect(mock.errors).toHaveLength(1)
    expect(mock.errors[0].fatal).toBe(true)
  })

  it('timeout: opens nothing', async () => {
    mock.override('api.open', timeoutAfter)
    mock.init({ documentId: 'f1' })
    expect(await api.consumePendingOpenDocx()).toBeNull()
    expect((mock.errors[0].error as { code: string }).code).toBe('timeout')
  })
})

describe('host open request -> onOpenDocx', () => {
  it('delivers to listeners after boot and answers {opened, title}', async () => {
    await bootWith()
    const seen: string[] = []
    const off = api.onOpenDocx((r) => seen.push(r.name))
    const other = mock.seed('Other.docx', DOCX)
    const res = await mock.host.open(mock.openPayload(other.fileId))
    off()
    expect(res).toEqual({ opened: true, title: 'Other.docx' })
    expect(seen).toEqual(['Other.docx'])
  })

  it('queues an open that arrives before the renderer booted', async () => {
    const meta = mock.seed('Early.docx', DOCX)
    await mock.host.open(mock.openPayload(meta.fileId))
    expect(((await api.consumePendingOpenDocx()) as OpenFileResult).name).toBe('Early.docx')
  })
})

describe('openDocxPath / openDocx', () => {
  it('success: reopens a bridge path', async () => {
    const first = await bootWith()
    const r = (await api.openDocxPath(first.path)) as OpenFileResult
    expect(r.path).toBe(first.path)
  })

  it('ignores non-bridge paths without a request', async () => {
    expect(await api.openDocxPath('C:\\docs\\a.docx')).toBeNull()
    expect(mock.calls).toHaveLength(0)
  })

  it('error / timeout -> null', async () => {
    expect(await api.openDocxPath('uniwork://files/zzz/a.docx')).toBeNull()
    mock.override('api.open', timeoutAfter)
    expect(await api.openDocxPath('uniwork://files/f1/a.docx')).toBeNull()
  })

  it('openDocx: success opens the picked file', async () => {
    mock.seed('Picked.docx', DOCX)
    const r = (await api.openDocx()) as OpenFileResult
    expect(r.name).toBe('Picked.docx')
    expect(mock.calls[0]).toMatchObject({ type: 'file.pick', payload: { purpose: 'open', accept: ['docx'] } })
    expect(mock.calls[0].opts?.timeoutMs).toBe(600_000)
  })

  it('openDocx: cancelled / error / timeout -> null', async () => {
    expect(await api.openDocx()).toBeNull() // empty store: picker returns {file: null}
    mock.override('file.pick', () => Promise.reject(protocolError('cancelled')))
    expect(await api.openDocx()).toBeNull()
    mock.override('file.pick', () => Promise.reject(protocolError('internal')))
    expect(await api.openDocx()).toBeNull()
    mock.override('file.pick', timeoutAfter)
    expect(await api.openDocx()).toBeNull()
  })
})

describe('saveDocx', () => {
  it('success: sends bytes + etag, tracks the new etag, emits saved', async () => {
    const doc = await bootWith()
    const data = buf([9, 9, 9])
    expect(await api.saveDocx(doc.path, data, false)).toEqual({ ok: true })
    expect(data.byteLength).toBe(3) // the renderer's buffer is copied, not transferred
    const call = mock.calls.at(-1)!
    expect(call.type).toBe('api.save')
    expect(call.payload).toMatchObject({ fileId: 'f1', etag: '"f1-v1"', auto: false })
    expect(call.opts?.transfer).toHaveLength(1)
    expect(mock.bytesOf('f1')).toEqual(new Uint8Array([9, 9, 9]))
    expect(mock.saved.at(-1)).toMatchObject({ file: { fileId: 'f1', versionId: 'v2' }, initiatedByFrame: true })
    // next save is based on the version this one created
    expect(await api.saveDocx(doc.path, buf([1]), true)).toEqual({ ok: true })
    expect(mock.calls.at(-1)!.payload).toMatchObject({ etag: '"f1-v2"', auto: true })
  })

  it('conflict: stale etag -> external-modified, stays unsaved', async () => {
    const doc = await bootWith()
    mock.bumpRemote('f1')
    const r = await api.saveDocx(doc.path, buf([5]))
    expect(r).toMatchObject({ ok: false, reason: 'external-modified' })
    expect(mock.saved).toHaveLength(0)
  })

  it('conflict as a rejected request maps the same way', async () => {
    const doc = await bootWith()
    mock.override('api.save', () => Promise.reject(protocolError('conflict', 'HTTP 409')))
    expect(await api.saveDocx(doc.path, buf([5]))).toMatchObject({ ok: false, reason: 'external-modified' })
  })

  it('error: surfaces the message', async () => {
    const doc = await bootWith()
    mock.override('api.save', () => ({ ok: false, error: { code: 'forbidden', message: 'read-only' } }))
    expect(await api.saveDocx(doc.path, buf([5]))).toEqual({ ok: false, error: 'read-only' })
    mock.override('api.save', () => Promise.reject(protocolError('internal', 'HTTP 500')))
    expect(await api.saveDocx(doc.path, buf([5]))).toEqual({ ok: false, error: 'HTTP 500' })
    mock.override('api.save', () => ({ nonsense: true }))
    expect((await api.saveDocx(doc.path, buf([5]))).ok).toBe(false)
  })

  it('timeout: reports a timed-out save', async () => {
    const doc = await bootWith()
    mock.override('api.save', timeoutAfter)
    expect(await api.saveDocx(doc.path, buf([5]))).toEqual({ ok: false, error: 'save timed out' })
    expect(mock.calls.at(-1)!.opts?.timeoutMs).toBe(120_000)
  })

  it('rejects a path that is not a UniWork document', async () => {
    expect((await api.saveDocx('/tmp/a.docx', buf([1]))).ok).toBe(false)
    expect(mock.calls).toHaveLength(0)
  })
})

describe('saveDocxAs / saveDocxNew', () => {
  it('saveDocxAs success: new file id, source passed, editor path switches', async () => {
    const doc = await bootWith()
    const r = await api.saveDocxAs('Copy', buf([7]), doc.path)
    expect(r.ok).toBe(true)
    expect(r.path).toBe('uniwork://files/f2/Copy.docx')
    expect(mock.calls.at(-1)!.payload).toMatchObject({ name: 'Copy.docx', sourceFileId: 'f1' })
    // later saves target the copy with its own etag
    expect(await api.saveDocx(r.path!, buf([8]))).toEqual({ ok: true })
    expect(mock.calls.at(-1)!.payload).toMatchObject({ fileId: 'f2', etag: '"f2-v1"' })
  })

  it('saveDocxAs cancelled -> {ok:false} without an error', async () => {
    mock.override('api.saveAs', () => ({ ok: false, error: { code: 'cancelled', message: 'user closed' } }))
    expect(await api.saveDocxAs('Copy', buf([7]))).toEqual({ ok: false })
  })

  it('saveDocxAs error / timeout', async () => {
    mock.override('api.saveAs', () => Promise.reject(protocolError('too_large', 'HTTP 413')))
    expect(await api.saveDocxAs('Copy', buf([7]))).toEqual({ ok: false, error: 'HTTP 413' })
    mock.override('api.saveAs', timeoutAfter)
    expect((await api.saveDocxAs('Copy', buf([7]))).ok).toBe(false)
  })

  it('saveDocxNew is a silent saveAs', async () => {
    const r = await api.saveDocxNew('Untitled', buf([1, 2]))
    expect(r).toEqual({ ok: true, path: 'uniwork://files/f1/Untitled.docx' })
    expect(mock.calls[0].payload).toMatchObject({ name: 'Untitled.docx', silent: true })
    mock.override('api.saveAs', timeoutAfter)
    expect((await api.saveDocxNew('Untitled', buf([1]))).ok).toBe(false)
  })
})

describe('getRecentFiles', () => {
  it('success: maps files to bridge paths', async () => {
    mock.seed('A.docx', DOCX)
    mock.seed('B.docx', DOCX)
    expect(await api.getRecentFiles()).toEqual(['uniwork://files/f2/B.docx', 'uniwork://files/f1/A.docx'])
    expect(mock.calls[0].payload).toEqual({ limit: 20 })
  })

  it('error / timeout / malformed -> []', async () => {
    mock.override('api.recents', () => Promise.reject(protocolError('unauthorized')))
    expect(await api.getRecentFiles()).toEqual([])
    mock.override('api.recents', timeoutAfter)
    expect(await api.getRecentFiles()).toEqual([])
    mock.override('api.recents', () => ({ files: 'x' }))
    expect(await api.getRecentFiles()).toEqual([])
  })
})

describe('exportPdf / print', () => {
  it('success: server PDF of the current file is downloaded', async () => {
    await bootWith()
    const r = await api.exportPdf('Report.docx', 12240, 15840, undefined, 1)
    expect(r).toEqual({ ok: true, path: 'Report.pdf' })
    expect(mock.calls.at(-1)!.payload).toMatchObject({
      format: 'pdf',
      fileId: 'f1',
      pageWidthTwips: 12240,
      pageHeightTwips: 15840,
    })
    expect(click).toHaveBeenCalledTimes(1)
    expect(window.print).not.toHaveBeenCalled()
  })

  it('unsaved document: in-frame print, no request', async () => {
    expect((await api.exportPdf('New', 1, 1)).ok).toBe(true)
    expect(window.print).toHaveBeenCalledTimes(1)
    expect(mock.calls).toHaveLength(0)
  })

  it('error / timeout: falls back to in-frame print', async () => {
    await bootWith()
    mock.override('api.export', () => Promise.reject(protocolError('unsupported')))
    expect((await api.exportPdf('Report', 1, 1)).ok).toBe(true)
    mock.override('api.export', timeoutAfter)
    expect((await api.exportPdf('Report', 1, 1)).ok).toBe(true)
    expect(window.print).toHaveBeenCalledTimes(2)
  })

  it('cancelled: no fallback', async () => {
    await bootWith()
    mock.override('api.export', () => Promise.reject(protocolError('cancelled')))
    expect(await api.exportPdf('Report', 1, 1)).toEqual({ ok: false })
    expect(window.print).not.toHaveBeenCalled()
  })

  it('deferred print parts become one export', async () => {
    await bootWith()
    const part = await api.printPdfBuffer(12240, 15840)
    expect(part.base64).toBe(WEB_PRINT_PART)
    expect((await api.saveMergedPdf('Report', [part.base64!, part.base64!])).ok).toBe(true)
    expect(mock.calls.filter((c) => c.type === 'api.export')).toHaveLength(1)
    expect((await api.saveMergedPdf('Report', ['realbase64'])).ok).toBe(false)
  })

  it('host print request: pdf mode exports, dialog mode prints', async () => {
    await bootWith()
    expect(await mock.host.print({ mode: 'pdf' })).toEqual({ printed: true })
    expect(mock.calls.at(-1)!.type).toBe('api.export')
    expect(await mock.host.print({})).toEqual({ printed: true })
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('exportHtml downloads locally', async () => {
    expect(await api.exportHtml('Report.docx', '<p>x</p>')).toEqual({ ok: true, path: 'Report.html' })
    expect((await api.exportHtml('Report.docx', '')).ok).toBe(false)
  })
})

describe('onRenamedDocx', () => {
  it('maps a host rename of a known file to old/new paths', async () => {
    const doc = await bootWith()
    const seen: Array<{ oldPath: string; newPath: string }> = []
    api.onRenamedDocx((p) => seen.push(p))
    mock.rename('f1', 'Renamed.docx')
    mock.rename('f1', 'Renamed.docx') // unchanged name: no event
    expect(seen).toEqual([{ oldPath: doc.path, newPath: 'uniwork://files/f1/Renamed.docx' }])
    // later saves keep the renamed name
    await api.saveDocx(seen[0].newPath, buf([1]))
    expect(mock.saved.at(-1)!.file.name).toBe('Renamed.docx')
  })

  it('ignores renames of files this frame never opened', async () => {
    const seen: unknown[] = []
    api.onRenamedDocx((p) => seen.push(p))
    mock.seed('Other.docx', DOCX)
    mock.rename('f1', 'X.docx')
    expect(seen).toEqual([])
  })
})

describe('fetchImage / convertAltChunkHtml', () => {
  it('fetchImage: data: URLs locally, http(s) through image.fetch', async () => {
    expect(await api.fetchImage('data:image/png;base64,AAAA')).toEqual({ base64: 'AAAA', mime: 'image/png' })
    expect(await api.fetchImage('data:image/svg+xml,%3Csvg%2F%3E')).toEqual({
      base64: btoa('<svg/>'),
      mime: 'image/svg+xml',
    })
    expect(mock.calls).toHaveLength(0)
    expect(await api.fetchImage('https://cdn/x.png')).toEqual({ base64: 'iVBORw0KGgo=', mime: 'image/png' })
    expect(mock.calls[0]).toMatchObject({ type: 'image.fetch', payload: { url: 'https://cdn/x.png' } })
    expect(await api.fetchImage('file:///etc/passwd')).toBeNull()
  })

  it('fetchImage: not found / error / timeout -> null', async () => {
    mock.override('image.fetch', () => ({ image: null }))
    expect(await api.fetchImage('https://cdn/x.png')).toBeNull()
    mock.override('image.fetch', () => Promise.reject(protocolError('forbidden')))
    expect(await api.fetchImage('https://cdn/x.png')).toBeNull()
    mock.override('image.fetch', timeoutAfter)
    expect(await api.fetchImage('https://cdn/x.png')).toBeNull()
  })

  it('convertAltChunkHtml: bytes on success, null otherwise', async () => {
    expect(await api.convertAltChunkHtml('<p>x</p>')).toEqual(new Uint8Array([0x50, 0x4b]))
    expect(await api.convertAltChunkHtml('')).toBeNull()
    mock.override('convert.altChunkHtml', () => ({ data: null }))
    expect(await api.convertAltChunkHtml('<p>x</p>')).toBeNull()
    mock.override('convert.altChunkHtml', () => Promise.reject(protocolError('unsupported')))
    expect(await api.convertAltChunkHtml('<p>x</p>')).toBeNull()
    mock.override('convert.altChunkHtml', timeoutAfter)
    expect(await api.convertAltChunkHtml('<p>x</p>')).toBeNull()
  })
})

describe('host save / saveAs requests (editor flows)', () => {
  /** stand-in for App.tsx's close-guard + menu wiring */
  function wireRenderer(path: () => string, save = () => api.saveDocx(path(), buf([4]))) {
    api.onCloseSaveRequest(() => {
      void save().then((r) => api.reportCloseSaveResult(r.ok))
    })
    api.onMenuCommand((cmd) => {
      if (cmd === 'save-as') void api.saveDocxAs('Report', buf([6]), path())
    })
  }

  it('save: runs the editor save flow and answers with the new version', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    const res = await mock.host.save({ reason: 'user' })
    expect(res).toMatchObject({ ok: true, file: { fileId: 'f1', versionId: 'v2' }, versionId: 'v2' })
    expect(mock.saved.at(-1)!.initiatedByFrame).toBe(false)
  })

  it('save conflict: answers ok:false with the conflict error', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    mock.bumpRemote('f1')
    const res = await mock.host.save({ reason: 'navigate' })
    expect(res).toMatchObject({ ok: false, error: { code: 'conflict' } })
  })

  it('save timeout / no document', async () => {
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({ ok: false, error: { code: 'not_ready' } })
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    mock.override('api.save', timeoutAfter)
    expect(await mock.host.save({ reason: 'autosave' })).toMatchObject({ ok: false, error: { code: 'timeout' } })
  })

  it('saveAs: drives the editor Save As with the host name', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    const res = await mock.host.saveAs({ name: 'Final' })
    expect(res).toMatchObject({ ok: true, file: { fileId: 'f2', name: 'Final.docx' } })
    expect(mock.calls.at(-1)!.payload).toMatchObject({ name: 'Final.docx', sourceFileId: 'f1' })
  })

  it('saveAs cancelled / no editor', async () => {
    expect(await mock.host.saveAs({})).toMatchObject({ ok: false, error: { code: 'not_ready' } })
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    mock.override('api.saveAs', () => Promise.reject(protocolError('cancelled')))
    expect(await mock.host.saveAs({})).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})

describe('dirty + title events', () => {
  it('answers the host close check from the guard', async () => {
    expect(await mock.host['doc.closeCheck']({})).toEqual({ dirty: false, autoSave: false })
    api.onCloseCheck(() => api.reportCloseCheck({ dirty: true, autoSave: true, filePath: 'p' }))
    expect(await mock.host['doc.closeCheck']({})).toEqual({ dirty: true, autoSave: true })
  })

  it('polls the close guard and pushes dirty changes', async () => {
    vi.useFakeTimers()
    mock = createMockPort()
    api = createWebApi(mock.port, { session: { pollMs: 100 } })
    let dirty = false
    api.onCloseCheck(() => api.reportCloseCheck({ dirty, autoSave: false }))
    vi.advanceTimersByTime(100)
    dirty = true
    vi.advanceTimersByTime(300)
    dirty = false
    vi.advanceTimersByTime(100)
    expect(mock.dirty).toEqual([false, true, false])
  })

  it('pushes document.title changes', async () => {
    document.title = 'Report.docx'
    await flush()
    expect(mock.titles.at(-1)).toBe('Report.docx')
  })
})

describe('projectApi (in-memory, AI-only)', () => {
  it('keeps chats per file and rebinds temp chats', async () => {
    const p = api.projectApi
    const temp = await p.resolveChat({ filePath: null, tempChatId: 'unsaved-1' })
    await p.appendChat({ ...temp, role: 'user', text: 'hello\nworld' })
    const bound = await p.rebindChat({
      projectId: temp.projectId,
      tempChatId: 'unsaved-1',
      newFilePath: 'uniwork://files/x/doc.docx',
    })
    expect(await p.resolveChat({ filePath: 'uniwork://files/x/doc.docx' })).toEqual(bound)
    expect((await p.loadChat(bound)).map((m) => m.text)).toEqual(['hello\nworld'])
    const tl = await p.getTimeline({ projectId: bound.projectId })
    expect(tl[0]).toMatchObject({ fileName: 'doc.docx', preview: 'hello' })
    const proj = await p.createProject({ name: 'P' })
    await p.moveFile({ filePath: 'uniwork://files/x/doc.docx', projectId: proj.id })
    const list = await p.listProjects()
    expect(list.find((x) => x.id === proj.id)?.fileCount).toBe(1)
  })
})
