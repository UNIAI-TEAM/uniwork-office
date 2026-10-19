// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFileResult } from '../../../apps/docs/src/shared/ipc'
import type { PortSession } from './frame-port'
import { createWebApi, idFromPath, pathFor, WEB_PRINT_PART, type WebApi } from './webapi'
import { hostGrants, webCapabilities } from './hide'
import { createMockPort, protocolError, timeoutAfter, type MockPort } from './testing/mock-port'
import { text } from './notice'
import { webText, type WebStringKey } from '../../modules/shared/i18n/strings-web'
import { setWebLanguage, webLanguage } from './browser'
import { frameAiRun } from '../../modules/shared/ai-run'
// the renderer's own reader: resolves the bridge's in-page handoff without fetch()
import { fetchDocBytes as bytesAt } from '../../../apps/docs/src/renderer/doc-bytes'
import {
  createIdbDraftStore,
  decryptDraft,
  type DraftChoice,
  type DraftInfo,
  type DraftRecovery,
  type DraftStore,
} from './draft-recovery'
import { createFakeIdb } from './testing/fake-idb'
import { bridgeDraftRecovery } from '../../modules/shared/recovery-prompt'
import { frameDocVersion } from '../../modules/shared/comments/doc-version'

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
async function bootWith(
  name = 'Report.docx',
  capabilities?: PortSession['capabilities'],
): Promise<OpenFileResult> {
  const meta = mock.seed(name, DOCX)
  mock.init({ documentId: meta.fileId, ...(capabilities ? { capabilities } : {}) })
  return (await api.consumePendingOpenDocx()) as OpenFileResult
}

const buf = (bytes: number[]) => new Uint8Array(bytes).buffer

/** the bridge's in-frame dialog (./notice.ts), once it is on screen */
async function dialogShown(marker: string): Promise<HTMLElement> {
  for (let i = 0; i < 50; i++) {
    const el = document.querySelector<HTMLElement>(`[data-docs-web="${marker}"]`)
    if (el) return el
    await flush()
  }
  throw new Error(`no ${marker} dialog`)
}

async function choose(marker: string, choice: string): Promise<void> {
  const el = await dialogShown(marker)
  // a confirmation step renders after an await: wait for the button too
  for (let i = 0; i < 50 && !el.querySelector(`[data-choice="${choice}"]`); i++) await flush()
  el.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)!.click()
}

/** the renderer's close guard reporting a dirty / clean document */
function guardDirty(dirty: boolean): void {
  api.onCloseCheck(() => api.reportCloseCheck({ dirty, autoSave: false }))
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // the browser print path settles on afterprint, like a real print dialog closing
  window.print = vi.fn(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  setup()
})

afterEach(() => {
  setWebLanguage('en', { host: true })
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.replaceChildren()
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
    expect(await bytesAt(first.dataUrl)).toEqual(DOCX)
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
      open: {
        file: { fileId: 'u1', name: 'Url.docx' },
        source: { kind: 'url', url: 'https://s3/signed' },
      },
    })
    const r = (await api.consumePendingOpenDocx()) as OpenFileResult
    expect(await bytesAt(r.dataUrl)).toEqual(DOCX)
    expect(fetchMock).toHaveBeenCalledWith('https://s3/signed', {
      credentials: 'omit',
      headers: undefined,
    })
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
    expect(mock.calls[0]).toMatchObject({
      type: 'file.pick',
      payload: { purpose: 'open', accept: ['docx'] },
    })
    expect(mock.calls[0].opts?.timeoutMs).toBe(0) // host dialog: no timeout
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
    expect(mock.saved.at(-1)).toMatchObject({
      file: { fileId: 'f1', versionId: 'v2' },
      initiatedByFrame: true,
    })
    // next save is based on the version this one created
    expect(await api.saveDocx(doc.path, buf([1]), true)).toEqual({ ok: true })
    expect(mock.calls.at(-1)!.payload).toMatchObject({ etag: '"f1-v2"', auto: true })
  })

  it('conflict: tells the host, asks the user; Cancel stays unsaved with a visible reason', async () => {
    const doc = await bootWith()
    mock.bumpRemote('f1')
    const pending = api.saveDocx(doc.path, buf([5]))
    const dlg = await dialogShown('conflict')
    expect(dlg.textContent).toContain(text('appWebConflictTitle'))
    expect(mock.errors).toEqual([
      { error: expect.objectContaining({ code: 'conflict' }), fatal: false },
    ])
    await choose('conflict', 'cancel')
    // no `reason`: the renderer shows its "Save failed: <error>" toast + status line
    expect(await pending).toEqual({ ok: false, error: text('appWebConflictNotSaved') })
    expect(mock.saved).toHaveLength(0)
    expect(document.querySelector('[data-docs-web="conflict"]')).toBeNull()
    // the etag is still stale: the next save asks again instead of failing silently
    const again = api.saveDocx(doc.path, buf([5]))
    await choose('conflict', 'cancel')
    expect((await again).ok).toBe(false)
    expect(mock.errors).toHaveLength(2)
  })

  it('conflict dialog: focus starts on Cancel, Overwrite is destructive, Esc cancels, Tab stays inside', async () => {
    const doc = await bootWith()
    mock.bumpRemote('f1')
    const pending = api.saveDocx(doc.path, buf([5]))
    const dlg = await dialogShown('conflict')
    const btn = (id: string) => dlg.querySelector<HTMLButtonElement>(`[data-choice="${id}"]`)!
    // a stray Enter must neither overwrite the other writer's version nor discard the edits
    expect(document.activeElement).toBe(btn('cancel'))
    expect(btn('reload').className).toBe('ow-dlg-btn primary')
    expect(btn('overwrite').className).toBe('ow-dlg-btn danger')
    expect(btn('overwrite').classList.contains('primary')).toBe(false)
    const box = dlg.querySelector('[role="alertdialog"]')!
    expect(document.getElementById(box.getAttribute('aria-labelledby')!)!.textContent).toBe(
      text('appWebConflictTitle'),
    )
    // the host learns that a frame modal is open (protocol `modal`)
    expect(mock.modals).toEqual([true])
    // Tab cycles inside the dialog (View differences, reload, overwrite, the way out, then the
    // close X), starting from Cancel: cancel -> X -> diff -> reload -> overwrite; Shift+Tab goes back
    const tab = (shiftKey = false) =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }))
    tab()
    expect(document.activeElement).toBe(dlg.querySelector('.ow-dlg-close'))
    tab()
    expect(document.activeElement).toBe(btn('diff'))
    tab()
    expect(document.activeElement).toBe(btn('reload'))
    tab()
    expect(document.activeElement).toBe(btn('overwrite'))
    tab(true)
    expect(document.activeElement).toBe(btn('reload'))
    tab(true)
    tab(true)
    tab(true)
    expect(document.activeElement).toBe(btn('cancel'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(await pending).toEqual({ ok: false, error: text('appWebConflictNotSaved') })
    expect(mock.saved).toHaveLength(0)
    expect(document.querySelector('[data-docs-web="conflict"]')).toBeNull()
    expect(mock.modals).toEqual([true, false])
  })

  it('conflict -> Save as a copy…: absent without saveCopy capability, present when saveCopy granted and editable, absent when view-only (UNI-1872)', async () => {
    // 1. Capability absent (default host without saveCopy) -> no hook even when editable
    const doc0 = await bootWith('Report.docx', { save: true })
    mock.bumpRemote('f1')
    const pending0 = api.saveDocx(doc0.path, buf([6]))
    const dlg0 = await dialogShown('conflict')
    expect(dlg0.querySelector('[data-choice="save-copy"]')).toBeNull()
    await choose('conflict', 'cancel')
    await pending0

    // 2. Capability present + editable -> hook offered
    setup()
    const doc = await bootWith('Report.docx', { save: true, saveCopy: true })
    mock.bumpRemote('f1')
    const pending1 = api.saveDocx(doc.path, buf([7, 8]))
    const dlg1 = await dialogShown('conflict')
    expect(dlg1.querySelector('[data-choice="save-copy"]')).not.toBeNull()
    await choose('conflict', 'cancel')
    await pending1

    // 3. Capability present + view-only -> no hook (and no overwrite)
    mock.override('api.save', () => {
      mock.rename('f1', 'Report-ro.docx', { writable: false })
      return Promise.reject(protocolError('conflict', 'HTTP 409'))
    })
    const pending2 = api.saveDocx(doc.path, buf([9]))
    const dlg2 = await dialogShown('conflict')
    expect(dlg2.querySelector('[data-choice="save-copy"]')).toBeNull()
    expect(dlg2.querySelector('[data-choice="overwrite"]')).toBeNull()
    await choose('conflict', 'cancel')
    await pending2
  })

  it('conflict -> Save as a copy… -> confirm: sends api.saveCopy with open bytes and localized copy name, shows Done alert without re-pointing open document (UNI-1872)', async () => {
    const doc = await bootWith('Report.docx', { save: true, saveCopy: true })
    const seenOpens: OpenFileResult[] = []
    api.onOpenDocx((r) => seenOpens.push(r as OpenFileResult))
    const remote = mock.bumpRemote('f1')
    const pending = api.saveDocx(doc.path, buf([9, 8, 7]))
    await choose('conflict', 'save-copy')
    await choose('conflict', 'go')

    const dlg = await dialogShown('conflict')
    // Back on step 1 with the Done alert quoting the copy's title
    for (let i = 0; i < 50 && !dlg.querySelector('.ow-dlg-alert')?.textContent; i++) await flush()
    const copyCalls = mock.calls.filter((c) => c.type === 'api.saveCopy')
    expect(copyCalls).toHaveLength(1)
    const sent = copyCalls[0]!.payload as { data: ArrayBuffer; name: string }
    expect(new Uint8Array(sent.data)).toEqual(new Uint8Array([9, 8, 7]))
    expect(sent.name).toBe('Report (copy)')
    expect(dlg.querySelector('.ow-dlg-alert')?.textContent).toBe(
      webText(webLanguage(), 'uwConflictSaveCopyDone', { title: 'Report (copy)' }),
    )
    // Open document was NOT re-pointed, reloaded, or reported saved
    expect(seenOpens).toEqual([])
    expect(mock.saved).toEqual([])
    expect(mock.bytesOf('f1')).toEqual(DOCX)

    // Still in step 1: Overwrite still targets f1 against remote.etag
    await choose('conflict', 'overwrite')
    await choose('conflict', 'go')
    expect(await pending).toEqual({ ok: true })
    const saves = mock.calls.filter((c) => c.type === 'api.save')
    expect(saves.map((c) => c.payload as { fileId: string; etag?: string })).toEqual([
      expect.objectContaining({ fileId: 'f1', etag: '"f1-v1"' }),
      expect.objectContaining({ fileId: 'f1', etag: remote.etag }),
    ])
  })

  it('conflict -> Save as a copy…: unsupported and generic/refusal errors show failed alert and keep edits safe (UNI-1872)', async () => {
    const doc = await bootWith('Báo cáo.docx', { save: true, saveCopy: true })
    setWebLanguage('vi', { host: true })
    mock.bumpRemote('f1')
    mock.override('api.saveCopy', () =>
      Promise.reject(protocolError('unsupported', 'api.saveCopy')),
    )
    const pending = api.saveDocx(doc.path, buf([4, 5]))
    await choose('conflict', 'save-copy')
    await choose('conflict', 'go')

    const dlg = await dialogShown('conflict')
    for (let i = 0; i < 50 && !dlg.querySelector('.ow-dlg-alert')?.textContent; i++) await flush()
    expect(dlg.querySelector('.ow-dlg-alert')?.textContent).toBe(
      webText('vi', 'uwConflictSaveCopyFailed'),
    )
    const sent = mock.calls.find((c) => c.type === 'api.saveCopy')!.payload as {
      name: string
    }
    expect(sent.name).toBe('Báo cáo (bản sao)')

    // Generic / host-refusal error (e.g. forbidden with apiCode copy_consent_required) also shows failed alert
    mock.override('api.saveCopy', () =>
      Promise.reject(
        protocolError('forbidden', 'copy refused', {
          status: 403,
          details: { apiCode: 'copy_consent_required' },
        }),
      ),
    )
    await choose('conflict', 'go')
    for (let i = 0; i < 50 && mock.calls.filter((c) => c.type === 'api.saveCopy').length < 2; i++) {
      await flush()
    }
    await flush()
    for (let i = 0; i < 50 && !dlg.querySelector('.ow-dlg-alert')?.textContent; i++) await flush()
    expect(dlg.querySelector('.ow-dlg-alert')?.textContent).toBe(
      webText('vi', 'uwConflictSaveCopyFailed'),
    )

    await choose('conflict', 'back')
    await choose('conflict', 'cancel')
    expect(await pending).toEqual({ ok: false, error: text('appWebConflictNotSaved') })
  })

  it('conflict -> Save as a copy…: too_large with details.max_bytes returns to step 1 with limit alert (UNI-1872)', async () => {
    const doc = await bootWith('Report.docx', { save: true, saveCopy: true })
    mock.bumpRemote('f1')
    mock.override('api.saveCopy', () =>
      Promise.reject(
        protocolError('too_large', 'HTTP 413', {
          status: 413,
          details: { max_bytes: 2 },
        }),
      ),
    )
    const pending = api.saveDocx(doc.path, buf([1, 2, 3, 4]))
    await choose('conflict', 'save-copy')
    await choose('conflict', 'go')

    const dlg = await dialogShown('conflict')
    for (
      let i = 0;
      i < 50 &&
      (!dlg.querySelector('.ow-dlg-alert')?.textContent ||
        !dlg.querySelector('[data-choice="save-copy"]'));
      i++
    ) {
      await flush()
    }
    expect(dlg.querySelector('.ow-dlg-alert')?.textContent).toContain('over 0 MB')
    expect(document.activeElement).toBe(dlg.querySelector('[data-choice="save-copy"]'))
    await choose('conflict', 'cancel')
    await pending
  })

  it('conflict -> Overwrite… -> confirm: re-reads the head etag and saves over the newer version', async () => {
    const doc = await bootWith()
    const remote = mock.bumpRemote('f1') // v2 by someone else
    const pending = api.saveDocx(doc.path, buf([7, 7]))
    await choose('conflict', 'overwrite')
    // the confirmation step replaces the content of the same dialog: nothing saved yet
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1)
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(1)
    await choose('conflict', 'go')
    expect(await pending).toEqual({ ok: true })
    const saves = mock.calls.filter((c) => c.type === 'api.save')
    expect(saves.map((c) => (c.payload as { etag?: string }).etag)).toEqual([
      '"f1-v1"',
      remote.etag,
    ])
    expect(mock.bytesOf('f1')).toEqual(new Uint8Array([7, 7]))
    expect(mock.saved.at(-1)).toMatchObject({ file: { versionId: 'v3' }, initiatedByFrame: true })
    // and the following save is based on the version it wrote
    expect(await api.saveDocx(doc.path, buf([8]))).toEqual({ ok: true })
  })

  it('conflict -> Reload latest: the latest version replaces the document, no error banner', async () => {
    const doc = await bootWith()
    const seen: OpenFileResult[] = []
    api.onOpenDocx((r) => seen.push(r as OpenFileResult))
    mock.bumpRemote('f1')
    const pending = api.saveDocx(doc.path, buf([5]))
    await choose('conflict', 'reload')
    // the web reload confirmation: discard the edits and reload (no download capability here)
    await choose('conflict', 'discard')
    expect(await pending).toEqual({ ok: false, reason: 'external-modified' })
    const reopened = await Promise.all(
      seen.map(async (r) => `${r.name}:${(await bytesAt(r.dataUrl)).length}`),
    )
    expect(reopened).toEqual([`Report.docx:${DOCX.length}`])
    // reopened at the head: the next save is not a conflict
    expect(await api.saveDocx(doc.path, buf([6]))).toEqual({ ok: true })
  })

  it('conflict on an autosave: reported to the host, no prompt', async () => {
    const doc = await bootWith()
    mock.override('api.save', () => Promise.reject(protocolError('conflict', 'HTTP 409')))
    expect(await api.saveDocx(doc.path, buf([5]), true)).toEqual({
      ok: false,
      reason: 'external-modified',
    })
    expect(document.querySelector('[data-docs-web="conflict"]')).toBeNull()
    expect(mock.errors[0]).toMatchObject({ error: { code: 'conflict' }, fatal: false })
  })

  it('error: shows the localized sentence of the failure, never the host message', async () => {
    const doc = await bootWith()
    mock.override('api.save', () => Promise.reject(protocolError('internal', 'HTTP 500')))
    expect(await api.saveDocx(doc.path, buf([5]))).toEqual({
      ok: false,
      error: 'The document could not be saved. Try again.',
    })
    mock.override('api.save', () => ({ nonsense: true }))
    expect((await api.saveDocx(doc.path, buf([5]))).ok).toBe(false)
    // last: a 403 means the access is gone, so the frame locks behind the bar afterwards
    mock.override('api.save', () => ({
      ok: false,
      error: { code: 'forbidden', message: 'read-only' },
    }))
    // the bar says it: no error text, so the editor raises no toast of its own
    expect(await api.saveDocx(doc.path, buf([5]))).toEqual({
      ok: false,
      reason: 'external-modified',
    })
  })

  it('timeout: reports a timed-out save', async () => {
    const doc = await bootWith()
    mock.override('api.save', timeoutAfter)
    expect(await api.saveDocx(doc.path, buf([5]))).toEqual({
      ok: false,
      error: text('appWebSaveOffline'),
    })
    expect(mock.calls.find((c) => c.type === 'api.save')!.opts?.timeoutMs).toBe(120_000)
  })

  it('network failure: a translated message, not the raw browser error', async () => {
    const doc = await bootWith()
    mock.override('api.save', () => Promise.reject(protocolError('network', 'Failed to fetch')))
    expect(await api.saveDocx(doc.path, buf([5]))).toEqual({
      ok: false,
      error: text('appWebSaveOffline'),
    })
  })

  it('timeout after the host committed: the next save is based on that version, no conflict', async () => {
    const doc = await bootWith()
    // the host wrote the bytes but the answer never came back
    mock.override('api.save', (payload) => {
      const { fileId, data } = payload as { fileId: string; data: ArrayBuffer }
      mock.commit(fileId, new Uint8Array(data))
      return timeoutAfter(payload, { timeoutMs: 120_000 })
    })
    expect(await api.saveDocx(doc.path, buf([5, 5]))).toEqual({
      ok: false,
      error: text('appWebSaveOffline'),
    })
    mock.clearOverrides()
    expect(await api.saveDocx(doc.path, buf([5, 5, 5]))).toEqual({ ok: true })
    expect(document.querySelector('[data-docs-web="conflict"]')).toBeNull()
  })

  it('timeout while someone else saved (other size): keeps the old etag, so the conflict is asked', async () => {
    const doc = await bootWith()
    mock.override('api.save', (payload) => {
      mock.bumpRemote('f1') // concurrent writer, original size
      return timeoutAfter(payload, { timeoutMs: 120_000 })
    })
    await api.saveDocx(doc.path, buf([5, 5]))
    mock.clearOverrides()
    const pending = api.saveDocx(doc.path, buf([5, 5, 5]))
    await choose('conflict', 'cancel')
    expect((await pending).ok).toBe(false)
  })

  it('timeout while someone else committed a same-size version: not adopted, the conflict is asked (RF-7)', async () => {
    const doc = await bootWith()
    mock.override('api.save', (payload) => {
      const { fileId } = payload as { fileId: string }
      // a foreign writer: same length as ours, other content
      mock.commit(fileId, new Uint8Array([9, 9]))
      return timeoutAfter(payload, { timeoutMs: 120_000 })
    })
    await api.saveDocx(doc.path, buf([5, 5]))
    mock.clearOverrides()
    const pending = api.saveDocx(doc.path, buf([5, 5, 5]))
    await choose('conflict', 'cancel')
    expect((await pending).ok).toBe(false)
  })

  it('a host-declined save (api.save "cancelled") is silent, like a cancelled Save As', async () => {
    const doc = await bootWith()
    // SAVE-01 (UNI-1909): the host declines the frame's own save to open its
    // name dialog — no status error, no toast, the document stays dirty
    mock.override('api.save', () => ({
      ok: false,
      error: { code: 'cancelled', message: 'cancelled', retryable: false },
    }))
    const res = await api.saveDocx(doc.path, buf([5]))
    expect(res.ok).toBe(false)
    expect(res).not.toHaveProperty('error')
    // the same refuse also settles a host-initiated save as cancelled
    expect((await api.saveDocx(doc.path, buf([6]))).ok).toBe(false)
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
    mock.override('api.saveAs', () => ({
      ok: false,
      error: { code: 'cancelled', message: 'user closed' },
    }))
    expect(await api.saveDocxAs('Copy', buf([7]))).toEqual({ ok: false })
  })

  it('saveDocxAs error / timeout', async () => {
    mock.override('api.saveAs', () => Promise.reject(protocolError('too_large', 'HTTP 413')))
    expect(await api.saveDocxAs('Copy', buf([7]))).toEqual({ ok: false })
    expect(document.querySelector('[data-office-web="save-blocked"]')).not.toBeNull()
    mock.override('api.saveAs', () => Promise.reject(protocolError('internal', 'HTTP 500')))
    expect(await api.saveDocxAs('Copy', buf([7]))).toEqual({
      ok: false,
      error: 'The document could not be saved. Try again.',
    })
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
    expect(await api.getRecentFiles()).toEqual([
      'uniwork://files/f2/B.docx',
      'uniwork://files/f1/A.docx',
    ])
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

  /** App.tsx's provideDocBytes + close-guard wiring */
  function wireLiveDoc(dirty: () => boolean, bytes: () => Promise<ArrayBuffer | null>) {
    api.onCloseCheck(() => api.reportCloseCheck({ dirty: dirty(), autoSave: false }))
    api.provideDocBytes(bytes)
  }

  it('dirty: sends the live docx bytes (transferred) with the file id', async () => {
    await bootWith()
    const live = buf([7, 7, 7])
    wireLiveDoc(
      () => true,
      async () => live,
    )
    expect((await api.exportPdf('Report', 12240, 15840)).ok).toBe(true)
    const call = mock.calls.at(-1)!
    expect(call.payload).toMatchObject({ format: 'pdf', fileId: 'f1' })
    expect(new Uint8Array((call.payload as { data: ArrayBuffer }).data)).toEqual(
      new Uint8Array([7, 7, 7]),
    )
    expect(call.opts?.transfer).toEqual([live])
  })

  it('clean: exports the stored version only, without serializing', async () => {
    await bootWith()
    const provider = vi.fn(async () => buf([1]))
    wireLiveDoc(() => false, provider)
    await api.exportPdf('Report', 1, 1)
    expect(mock.calls.at(-1)!.payload).not.toHaveProperty('data')
    expect(mock.calls.at(-1)!.opts?.transfer).toBeUndefined()
    expect(provider).not.toHaveBeenCalled()
  })

  it('never-saved document: exports the live bytes without a file id', async () => {
    wireLiveDoc(
      () => true,
      async () => buf([3]),
    )
    expect(await api.exportPdf('New', 1, 1)).toEqual({ ok: true, path: 'New.pdf' })
    expect(mock.calls[0].payload).not.toHaveProperty('fileId')
    expect(mock.calls[0].payload).toHaveProperty('data')
    expect(window.print).not.toHaveBeenCalled()
  })

  it('serializer failure: falls back to the stored version; unregister stops it', async () => {
    await bootWith()
    api.onCloseCheck(() => api.reportCloseCheck({ dirty: true, autoSave: false }))
    const off = api.provideDocBytes(async () => {
      throw new Error('boom')
    })
    expect((await api.exportPdf('Report', 1, 1)).ok).toBe(true)
    expect(mock.calls.at(-1)!.payload).toMatchObject({ fileId: 'f1' })
    expect(mock.calls.at(-1)!.payload).not.toHaveProperty('data')
    off()
    await api.exportPdf('Report', 1, 1)
    expect(mock.calls.at(-1)!.payload).not.toHaveProperty('data')
  })

  it('dirty + export error: still falls back to print', async () => {
    await bootWith()
    wireLiveDoc(
      () => true,
      async () => buf([7]),
    )
    mock.override('api.export', () => Promise.reject(protocolError('unsupported')))
    expect((await api.exportPdf('Report', 1, 1)).ok).toBe(true)
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('unsaved document: in-frame print, no request', async () => {
    expect((await api.exportPdf('New', 1, 1)).ok).toBe(true)
    expect(window.print).toHaveBeenCalledTimes(1)
    expect(mock.calls).toHaveLength(0)
  })

  it('error / timeout: falls back to in-frame print', async () => {
    await bootWith()
    mock.override('api.export', () => Promise.reject(protocolError('unsupported')))
    // nothing was exported: no file name, the renderer reports the print dialog instead
    expect(await api.exportPdf('Report', 1, 1)).toEqual({ ok: true, printDialog: true })
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

  it('host print request goes through the browser print path and answers after it settles', async () => {
    await bootWith()
    let during: { theme: string | null; sheet: boolean } | null = null
    document.documentElement.setAttribute('data-theme', 'dark')
    window.print = vi.fn(() => {
      during = {
        theme: document.documentElement.getAttribute('data-theme'),
        sheet: !!document.getElementById('web-bridge-print-page'),
      }
      // the dialog stays open: afterprint comes later
      setTimeout(() => window.dispatchEvent(new Event('afterprint')), 20)
    })
    let answered = false
    const pending = (mock.host.print({ mode: 'dialog' }) as Promise<unknown>).then((r) => {
      answered = true
      return r
    })
    await new Promise((r) => setTimeout(r, 5))
    expect(during).toEqual({ theme: 'light', sheet: true })
    expect(answered).toBe(false)
    expect(await pending).toEqual({ printed: true })
    expect(document.getElementById('web-bridge-print-page')).toBeNull()
    document.documentElement.removeAttribute('data-theme')
  })

  it('host print request reports printed:false when the browser refuses to print', async () => {
    await bootWith()
    window.print = vi.fn(() => {
      throw new Error('blocked')
    })
    expect(await mock.host.print({})).toEqual({ printed: false })
  })

  it('exportHtml downloads locally', async () => {
    expect(await api.exportHtml('Report.docx', '<p>x</p>')).toEqual({
      ok: true,
      path: 'Report.html',
    })
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

  it('a save result that carries a new name is a rename the renderer hears (S01B-V1)', async () => {
    const doc = await bootWith()
    const seen: Array<{ oldPath: string; newPath: string }> = []
    api.onRenamedDocx((p) => seen.push(p))
    // the host named the file in its own dialog and its api.save result carries it;
    // the file.renamed event it sent first already told the frame (swallow guard) or
    // never arrived — either way the merge must surface the change once
    mock.override('api.save', () => {
      const meta = mock.commit('f1', new Uint8Array([7]))
      meta.name = 'Kế hoạch Q4.docx'
      return { ok: true, file: meta, versionId: meta.versionId }
    })
    const res = await api.saveDocx(doc.path, buf([7]))
    expect(res).toEqual({ ok: true })
    expect(seen).toEqual([{ oldPath: doc.path, newPath: 'uniwork://files/f1/Kế hoạch Q4.docx' }])
    // and a later file.renamed carrying the same name still emits nothing
    mock.rename('f1', 'Kế hoạch Q4.docx')
    expect(seen).toHaveLength(1)
  })

  it('a file.renamed during an in-flight save is never clobbered by the save result', async () => {
    const doc = await bootWith()
    const seen: Array<{ oldPath: string; newPath: string }> = []
    api.onRenamedDocx((p) => seen.push(p))
    // SAVE-01 order: the host emits file.renamed BEFORE the reissued save lands
    mock.override('api.save', () => {
      mock.rename('f1', 'Kế hoạch Q4.docx')
      const meta = mock.commit('f1', new Uint8Array([9]))
      return { ok: true, file: meta, versionId: meta.versionId }
    })
    const res = await api.saveDocx(doc.path, buf([9]))
    expect(res).toEqual({ ok: true })
    expect(seen).toEqual([{ oldPath: doc.path, newPath: 'uniwork://files/f1/Kế hoạch Q4.docx' }])
    // the next save still targets the renamed file with its newest etag
    await api.saveDocx('uniwork://files/f1/Kế hoạch Q4.docx', buf([1]))
    expect(mock.saved.at(-1)!.file.name).toBe('Kế hoạch Q4.docx')
  })
})

describe('fetchImage / convertAltChunkHtml', () => {
  it('fetchImage: data: URLs locally, http(s) through image.fetch', async () => {
    expect(await api.fetchImage('data:image/png;base64,AAAA')).toEqual({
      base64: 'AAAA',
      mime: 'image/png',
    })
    expect(await api.fetchImage('data:image/svg+xml,%3Csvg%2F%3E')).toEqual({
      base64: btoa('<svg/>'),
      mime: 'image/svg+xml',
    })
    expect(mock.calls).toHaveLength(0)
    expect(await api.fetchImage('https://cdn/x.png')).toEqual({
      base64: 'iVBORw0KGgo=',
      mime: 'image/png',
    })
    expect(mock.calls[0]).toMatchObject({
      type: 'image.fetch',
      payload: { url: 'https://cdn/x.png' },
    })
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
  function wireRenderer(
    path: () => string,
    save = () => api.saveDocx(path(), buf([4])),
    /** ms the renderer's Save As flow spends serializing before it calls saveDocxAs */
    saveAsDelayMs = 0,
  ) {
    api.onCloseSaveRequest(() => {
      void save().then((r) => api.reportCloseSaveResult(r.ok))
    })
    api.onMenuCommand((cmd) => {
      if (cmd !== 'save-as') return
      const run = () => void api.saveDocxAs('Report', buf([6]), path())
      if (saveAsDelayMs > 0) setTimeout(run, saveAsDelayMs)
      else run()
    })
  }

  it('save: runs the editor save flow and answers with the new version', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    const res = await mock.host.save({ reason: 'user' })
    expect(res).toMatchObject({
      ok: true,
      file: { fileId: 'f1', versionId: 'v2' },
      versionId: 'v2',
    })
    expect(mock.saved.at(-1)!.initiatedByFrame).toBe(false)
  })

  it('save conflict: the frame shows the one conflict dialog; Cancel answers cancelled', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    mock.bumpRemote('f1')
    const res = mock.host.save({ reason: 'user' })
    await dialogShown('conflict')
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1)
    expect(mock.modals).toEqual([true])
    await choose('conflict', 'cancel')
    expect(await res).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(document.querySelector('[data-docs-web="conflict"]')).toBeNull()
    expect(mock.modals).toEqual([true, false])
    // the host's own save hears the answer, not an error event
    expect(mock.errors).toHaveLength(0)
  })

  it('save conflict -> Overwrite… confirmed: answers ok with the new version', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    mock.bumpRemote('f1')
    const res = mock.host.save({ reason: 'user' })
    await choose('conflict', 'overwrite')
    await choose('conflict', 'go')
    expect(await res).toMatchObject({ ok: true, file: { fileId: 'f1' }, versionId: 'v3' })
    expect(mock.saved.at(-1)).toMatchObject({ initiatedByFrame: false })
  })

  it('save conflict -> Reload latest: answers ok without a versionId', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    mock.bumpRemote('f1')
    const res = mock.host.save({ reason: 'navigate' })
    await choose('conflict', 'reload')
    await choose('conflict', 'discard')
    const answer = await res
    expect(answer).toMatchObject({ ok: true, file: { fileId: 'f1', versionId: 'v2' } })
    expect(answer).not.toHaveProperty('versionId')
  })

  it('save conflict without the download capability: no download choice', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    mock.bumpRemote('f1')
    const res = mock.host.save({ reason: 'user' })
    await choose('conflict', 'reload')
    await choose('conflict', 'back')
    expect(document.querySelector('[data-choice="download"]')).toBeNull()
    await choose('conflict', 'cancel')
    await res
  })

  it('save conflict with the download capability: the bytes go to api.download, then Reload', async () => {
    const meta = mock.seed('Report.docx', DOCX)
    mock.init({ documentId: meta.fileId, capabilities: { save: true, download: true } })
    const doc = (await api.consumePendingOpenDocx()) as OpenFileResult
    wireRenderer(
      () => doc.path,
      () => api.saveDocx(doc.path, buf([4, 4])),
    )
    mock.bumpRemote('f1')
    const res = mock.host.save({ reason: 'user' })
    await choose('conflict', 'reload')
    await choose('conflict', 'download')
    await dialogShown('conflict')
    for (let i = 0; i < 20; i++) await flush()
    const sent = mock.calls.find((c) => c.type === 'api.download')!
    // bytes only: the host names, types and size-checks the file
    expect(Object.keys(sent.payload as object)).toEqual(['data'])
    expect(new Uint8Array((sent.payload as { data: ArrayBuffer }).data)).toEqual(
      new Uint8Array([4, 4]),
    )
    // the frame waits for the user to confirm they have the file
    expect(mock.calls.filter((c) => c.type === 'api.open')).toHaveLength(2)
    await choose('conflict', 'go')
    expect(await res).toMatchObject({ ok: true, file: { fileId: 'f1' } })
  })

  it('save conflict with the download capability and my version over init.downloadMaxBytes: the download choice is aria-disabled up front', async () => {
    const meta = mock.seed('Report.docx', DOCX)
    mock.init({
      documentId: meta.fileId,
      capabilities: { save: true, download: true },
      downloadMaxBytes: 1,
    })
    const doc = (await api.consumePendingOpenDocx()) as OpenFileResult
    wireRenderer(
      () => doc.path,
      () => api.saveDocx(doc.path, buf([4, 4])),
    )
    mock.bumpRemote('f1')
    const res = mock.host.save({ reason: 'user' })
    await choose('conflict', 'reload')
    await vi.waitFor(() =>
      expect(document.querySelector('[data-choice="download"]')).not.toBeNull(),
    )
    const download = document.querySelector('[data-choice="download"]') as HTMLElement
    expect(download.getAttribute('aria-disabled')).toBe('true')
    download.click()
    for (let i = 0; i < 5; i++) await flush()
    expect(mock.calls.some((c) => c.type === 'api.download')).toBe(false)
    await choose('conflict', 'back')
    await choose('conflict', 'cancel')
    await res
  })

  it('save conflict: a version exactly at init.downloadMaxBytes can still be downloaded', async () => {
    const meta = mock.seed('Report.docx', DOCX)
    mock.init({
      documentId: meta.fileId,
      capabilities: { save: true, download: true },
      downloadMaxBytes: 2,
    })
    const doc = (await api.consumePendingOpenDocx()) as OpenFileResult
    wireRenderer(
      () => doc.path,
      () => api.saveDocx(doc.path, buf([4, 4])),
    )
    mock.bumpRemote('f1')
    const res = mock.host.save({ reason: 'user' })
    await choose('conflict', 'reload')
    await vi.waitFor(() =>
      expect(document.querySelector('[data-choice="download"]')).not.toBeNull(),
    )
    expect(
      document.querySelector('[data-choice="download"]')!.getAttribute('aria-disabled'),
    ).toBeNull()
    await choose('conflict', 'back')
    await choose('conflict', 'cancel')
    await res
  })

  it('save conflict -> Overwrite gets 401: the session line, closing answers unauthorized', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    mock.bumpRemote('f1')
    const res = mock.host.save({ reason: 'user' })
    await choose('conflict', 'overwrite')
    mock.override('api.save', () => Promise.reject(protocolError('unauthorized', 'HTTP 401')))
    await choose('conflict', 'go')
    await choose('conflict', 'cancel')
    expect(await res).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
  })

  it('save conflict: the editor result carries the localized conflict sentence, not the server message', async () => {
    const doc = await bootWith()
    let seen: {
      ok: boolean
      error?: string
      reason?: 'external-modified' | 'cancelled'
    } | null = null
    wireRenderer(
      () => doc.path,
      async () => {
        seen = await api.saveDocx(doc.path, buf([4]))
        return seen
      },
    )
    mock.override('api.save', () =>
      Promise.reject(protocolError('conflict', 'stale etag (HTTP 409)')),
    )
    const res = mock.host.save({ reason: 'navigate' })
    await choose('conflict', 'cancel')
    await res
    expect(seen).toMatchObject({ ok: false })
    expect(seen!.error).toBe(text('appWebConflictNotSaved'))
    expect(seen!.error).not.toMatch(/stale etag|409|try again/i)
  })

  it('save while a save runs: busy, not conflict', async () => {
    const doc = await bootWith()
    let release!: () => void
    wireRenderer(
      () => doc.path,
      () => new Promise<void>((r) => (release = r)).then(() => api.saveDocx(doc.path, buf([4]))),
    )
    const first = mock.host.save({ reason: 'user' })
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'busy' },
    })
    release()
    expect(await first).toMatchObject({ ok: true })
  })

  it('save timeout / no document', async () => {
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'not_ready' },
    })
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    mock.override('api.save', timeoutAfter)
    expect(await mock.host.save({ reason: 'autosave' })).toMatchObject({
      ok: false,
      error: { code: 'timeout' },
    })
  })

  it('saveAs: drives the editor Save As with the host name', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    const res = await mock.host.saveAs({ name: 'Final' })
    expect(res).toMatchObject({ ok: true, file: { fileId: 'f2', name: 'Final.docx' } })
    expect(mock.calls.at(-1)!.payload).toMatchObject({ name: 'Final.docx', sourceFileId: 'f1' })
  })

  it('saveAs: a renderer that serializes first (real delay) still gets the host name', async () => {
    const doc = await bootWith()
    wireRenderer(() => doc.path, undefined, 20)
    const res = await mock.host.saveAs({ name: 'Final' })
    expect(res).toMatchObject({ ok: true, file: { name: 'Final.docx' } })
    const saveAs = mock.calls.filter((c) => c.type === 'api.saveAs')
    expect(saveAs.map((c) => (c.payload as { name: string }).name)).toEqual(['Final.docx'])
    expect(mock.saved.at(-1)!.initiatedByFrame).toBe(false)
  })

  it('saveAs: times out only when the editor never starts Save As', async () => {
    const doc = await bootWith()
    vi.useFakeTimers()
    api.onMenuCommand(() => {}) // listens, never calls saveDocxAs
    let outcome: unknown = 'pending'
    void (mock.host.saveAs({ name: 'Final' }) as Promise<unknown>).then((r) => (outcome = r))
    await vi.advanceTimersByTimeAsync(29_000)
    expect(outcome).toBe('pending')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(outcome).toMatchObject({ ok: false, error: { code: 'timeout' } })
    expect(doc.name).toBe('Report.docx')
  })

  it('saveAs cancelled / no editor', async () => {
    expect(await mock.host.saveAs({})).toMatchObject({ ok: false, error: { code: 'not_ready' } })
    const doc = await bootWith()
    wireRenderer(() => doc.path)
    mock.override('api.saveAs', () => Promise.reject(protocolError('cancelled')))
    expect(await mock.host.saveAs({})).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})

describe('replacing a dirty document', () => {
  it('openDocxPath asks first; Cancel keeps the document, Discard opens', async () => {
    const doc = await bootWith()
    guardDirty(true)
    const cancelled = api.openDocxPath(doc.path)
    await choose('discard', 'cancel')
    expect(await cancelled).toBeNull()
    expect(mock.calls.filter((c) => c.type === 'api.open')).toHaveLength(1) // boot only
    const opened = api.openDocxPath(doc.path)
    await choose('discard', 'discard')
    expect((await opened)?.name).toBe('Report.docx')
  })

  it('openDocx asks after the pick, and not at all when clean', async () => {
    await bootWith()
    guardDirty(true)
    const p = api.openDocx()
    await choose('discard', 'cancel')
    expect(await p).toBeNull()
    expect(mock.calls.at(-1)!.type).toBe('file.pick')
    document.body.replaceChildren()
    const clean = createMockPort()
    const cleanApi = createWebApi(clean.port, { session: { pollMs: 0 } })
    clean.seed('Picked.docx', DOCX)
    cleanApi.onCloseCheck(() => cleanApi.reportCloseCheck({ dirty: false, autoSave: false }))
    expect((await cleanApi.openDocx())?.name).toBe('Picked.docx')
    expect(document.querySelector('[data-docs-web="discard"]')).toBeNull()
  })
})

describe('fatal open failure', () => {
  it('shows a blocking notice and refuses every save until the host opens a document', async () => {
    mock.init({ documentId: 'nope' })
    expect(await api.consumePendingOpenDocx()).toBeNull()
    const notice = await dialogShown('fatal')
    expect(notice.textContent).toContain(text('appWebFatalTitle'))
    mock.calls.length = 0
    expect(await api.saveDocxNew('Untitled', buf([1]))).toEqual({
      ok: false,
      error: text('appWebFatalTitle'),
    })
    expect(await api.saveDocx('uniwork://files/nope/x.docx', buf([1]))).toMatchObject({
      ok: false,
    })
    expect((await api.saveDocxAs('x', buf([1]))).ok).toBe(false)
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({ ok: false, error: {} })
    expect(mock.calls).toHaveLength(0) // nothing reached the host: no silent Untitled document

    const meta = mock.seed('Later.docx', DOCX)
    expect(await mock.host.open(mock.openPayload(meta.fileId))).toMatchObject({ opened: true })
    expect(document.querySelector('[data-docs-web="fatal"]')).toBeNull()
    expect(await api.saveDocx(pathFor(meta), buf([2]))).toEqual({ ok: true })
  })

  it('init timeout (no host answered) lands in the same fatal state', async () => {
    const port = createMockPort()
    const failing = createWebApi(
      { ...port.port, whenInitialized: () => Promise.reject(protocolError('timeout')) },
      { session: { pollMs: 0 } },
    )
    expect(await failing.consumePendingOpenDocx()).toBeNull()
    await dialogShown('fatal')
    expect(port.errors[0]).toMatchObject({ fatal: true })
    expect((await failing.saveDocxNew('Untitled', buf([1]))).ok).toBe(false)
    expect(port.calls).toHaveLength(0)
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

  it('an edit event reports dirty without waiting for the poll', async () => {
    vi.useFakeTimers()
    mock = createMockPort()
    api = createWebApi(mock.port, { session: { pollMs: 0 } })
    let dirty = false
    api.onCloseCheck(() => api.reportCloseCheck({ dirty, autoSave: false }))
    dirty = true
    document.body.dispatchEvent(new Event('input', { bubbles: true }))
    // several edit events in a burst: one query
    document.body.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
    expect(mock.dirty).toEqual([])
    vi.advanceTimersByTime(150)
    expect(mock.dirty).toEqual([true])
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
  })
})

describe('draft recovery (C18)', () => {
  let store: DraftStore
  let key: CryptoKey
  let answer: DraftChoice
  let prompt: ReturnType<typeof vi.fn<(d: DraftInfo) => Promise<DraftChoice>>>
  let drafts: DraftRecovery

  /** a frame load: a fresh bridge on the same store, the init carrying the session's grant */
  async function load(extra: Partial<PortSession> = {}): Promise<OpenFileResult> {
    mock = createMockPort()
    api = createWebApi(mock.port, {
      session: { pollMs: 0 },
      drafts: (host) =>
        (drafts = bridgeDraftRecovery(mock.port, 'docs', host, {
          store,
          prompt,
          target: new EventTarget() as unknown as Window,
        })),
    })
    const meta = mock.seed('Report.docx', DOCX)
    mock.init({ documentId: meta.fileId, recovery: { key, scope: `u1:${meta.fileId}` }, ...extra })
    return (await api.consumePendingOpenDocx()) as OpenFileResult
  }

  async function editAndKeep(bytes: number[]): Promise<void> {
    api.onCloseCheck(() => api.reportCloseCheck({ dirty: true, autoSave: false }))
    api.provideDocBytes(async () => buf(bytes))
    await drafts.flush()
  }

  beforeEach(async () => {
    store = createIdbDraftStore(createFakeIdb().idb)
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    answer = 'restore'
    prompt = vi.fn(async (_d: DraftInfo) => answer)
  })
  afterEach(() => drafts?.dispose())

  it('keeps an encrypted copy while dirty and offers it on the next load: Restore = recovered', async () => {
    await load()
    await editAndKeep([9, 9, 9])
    expect(mock.calls.some((c) => c.type === 'api.save')).toBe(false)
    drafts.dispose()

    const reopened = await load()
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Report.docx', older: false }),
    )
    expect(reopened.recovered).toBe(true)
    expect(await bytesAt(reopened.dataUrl)).toEqual(new Uint8Array([9, 9, 9]))
    expect(reopened.path).toBe(pathFor({ fileId: 'f1', name: 'Report.docx' }))
    expect((await store.list('u1:f1:')).length).toBe(1)

    // the user's save lands: the copy is gone
    expect((await api.saveDocx(reopened.path, buf([9, 9, 9]))).ok).toBe(true)
    api.onCloseCheck(() => api.reportCloseCheck({ dirty: false, autoSave: false }))
    await drafts.flush()
    expect(await store.list('u1:f1:')).toEqual([])
  })

  it('Discard opens the server version and deletes the copy', async () => {
    await load()
    await editAndKeep([5])
    drafts.dispose()
    answer = 'discard'
    const reopened = await load()
    expect(reopened.recovered).toBeUndefined()
    expect(await bytesAt(reopened.dataUrl)).toEqual(DOCX)
    expect(await store.list('u1:f1:')).toEqual([])
  })

  it('a copy under another key is skipped without a prompt and never deleted', async () => {
    await load()
    await editAndKeep([5])
    drafts.dispose()
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const reopened = await load()
    expect(prompt).not.toHaveBeenCalled()
    expect(reopened.recovered).toBeUndefined()
    // another key (a later sign-in) or another tab: the record stays for the sign-out cleanup
    expect(await store.list('u1:f1:')).toHaveLength(1)
  })

  it('a document opened in the frame other than the init document is never drafted', async () => {
    await load()
    const other = mock.seed('Other.docx', DOCX)
    await api.openDocxPath(pathFor(other))
    await editAndKeep([1])
    expect(await store.list('u1:f1:')).toEqual([])
  })

  it('a blocked save still writes the draft (SIZE-F1 persistDraft -> drafts.flush)', async () => {
    const doc = await load({ limits: { max_bytes: 100, warn_ratio: 0.7 } })
    api.onCloseCheck(() => api.reportCloseCheck({ dirty: true, autoSave: false }))
    api.provideDocBytes(async () => buf([9, 9, 9]))

    // 120 B > 100 B max_bytes: the gate refuses api.save and persists the draft instead
    const blocked = await api.saveDocx(doc.path, buf(new Array(120).fill(7)))
    expect(blocked.ok).toBe(false)
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(0)
    expect(mock.saveBlocked).toHaveLength(1)

    const draftsOnStore = await store.list('u1:f1:')
    expect(draftsOnStore).toHaveLength(1)
    const plaintext = await decryptDraft(key, draftsOnStore[0]!.key, draftsOnStore[0]!.record)
    expect(plaintext ? Array.from(new Uint8Array(plaintext)) : null).toEqual([9, 9, 9])
  })
})

describe('view-only (host withholds the save grant)', () => {
  const GRANTS = { save: true, saveAs: true, recents: true }

  async function boot(
    capabilities: Record<string, boolean> | undefined,
    writable?: boolean,
  ): Promise<OpenFileResult> {
    const meta = mock.seed('Report.docx', DOCX)
    if (writable === false)
      mock.override('api.open', () => ({
        file: { ...meta, writable: false },
        source: { kind: 'bytes', data: DOCX.slice().buffer },
      }))
    mock.init({ documentId: meta.fileId, ...(capabilities ? { capabilities } : {}) })
    return (await api.consumePendingOpenDocx()) as OpenFileResult
  }

  it('answers uniworkState readOnly so the renderer makes the editor read-only', async () => {
    const doc = await boot({ ...GRANTS, save: false })
    expect(await api.uniworkState(doc.path)).toEqual({ bound: false, readOnly: true })
  })

  it('answers readOnly for a file the host marks writable:false even with the save grant', async () => {
    const doc = await boot(GRANTS, false)
    expect(await api.uniworkState(doc.path)).toEqual({ bound: false, readOnly: true })
  })

  it('stays editable with the save grant', async () => {
    const doc = await boot(GRANTS)
    expect(await api.uniworkState(doc.path)).toEqual({ bound: false, readOnly: false })
  })

  it('refuses saveDocx without calling api.save', async () => {
    const doc = await boot({ ...GRANTS, save: false })
    const res = await api.saveDocx(doc.path, buf([5]), false)
    expect(res).toEqual({ ok: false, error: 'read-only document' })
    expect(mock.calls.some((c) => c.type === 'api.save')).toBe(false)
    expect(mock.saved).toEqual([])
  })

  it('answers a host save request unsupported and never starts the editor flow', async () => {
    await boot({ ...GRANTS, save: false })
    const res = await mock.host.save({ reason: 'user' })
    expect(res).toMatchObject({ ok: false, error: { code: 'unsupported' } })
  })

  it('refuses Save As too unless the host grants saveAs separately', async () => {
    const doc = await boot({ ...GRANTS, save: false, saveAs: false })
    expect(await api.saveDocxAs('Copy', buf([5]), doc.path)).toEqual({
      ok: false,
      error: 'read-only document',
    })
    expect(mock.calls.some((c) => c.type === 'api.saveAs')).toBe(false)
  })

  it('allows a saved copy when the host grants saveAs', async () => {
    const doc = await boot({ ...GRANTS, save: false })
    const res = await api.saveDocxAs('Copy', buf([5]), doc.path)
    expect(res.ok).toBe(true)
    expect(mock.calls.some((c) => c.type === 'api.saveAs')).toBe(true)
  })
})

// ---------------------------------------------------------------- new version on UniWork (G5-03w, S6)

describe('new version on UniWork (doc.remoteVersion)', () => {
  const wt = (key: WebStringKey, params?: Record<string, string>) =>
    webText(webLanguage(), key, params)
  const bar = () => document.querySelector<HTMLElement>('.uw-remote-bar')
  const barText = () => bar()?.querySelector('.uw-remote-bar-text')?.textContent ?? null
  const event = (revision: string, fileId = 'f1') => ({
    document_id: fileId,
    revision,
    version_id: `v${revision}`,
    saved_at: new Date(Date.UTC(2026, 9, 12, 8)).toISOString(),
    author_name: 'Trần An',
  })
  /** the host answers api.open with the head: the new bytes and the head's own revision */
  function serveHead(revision: string, bytes: Uint8Array): void {
    mock.override('api.open', (payload) => {
      const { fileId } = payload as { fileId: string }
      const open = mock.openPayload(fileId)
      return {
        // the real host: the etag is the document revision of the same read
        file: { ...open.file, etag: revision, revision, versionId: `v${revision}` },
        source: { kind: 'bytes', data: bytes.slice().buffer },
      }
    })
  }
  async function bootRevision(revision: string): Promise<OpenFileResult> {
    const meta = mock.seed('Report.docx', DOCX)
    mock.init({
      documentId: meta.fileId,
      open: { ...mock.openPayload(meta.fileId), file: { ...meta, revision } },
    })
    return (await api.consumePendingOpenDocx()) as OpenFileResult
  }

  it('clean: reloads through api.open (the event version) and hands the head to the renderer', async () => {
    const delivered: OpenFileResult[] = []
    await bootRevision('10')
    api.onOpenDocx((r) => {
      if ('dataUrl' in r) delivered.push(r)
    })
    guardDirty(false)
    const head = new Uint8Array([0x50, 0x4b, 9, 9])
    serveHead('12', head)
    mock.sendRemoteVersion(event('12'))
    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    const open = mock.calls.filter((c) => c.type === 'api.open').at(-1)!
    expect(open.payload).toEqual({ fileId: 'f1', versionId: 'v12' })
    expect(await bytesAt(delivered[0]!.dataUrl)).toEqual(head)
    expect(barText()).toContain('version 12')
    expect(barText()).toContain('Trần An')
  })

  it('the Save after a head reload is based on the reply (etag = its revision), not the old copy', async () => {
    const delivered: OpenFileResult[] = []
    await bootRevision('10')
    api.onOpenDocx((r) => {
      if ('dataUrl' in r) delivered.push(r)
    })
    guardDirty(false)
    serveHead('12', new Uint8Array([0x50, 0x4b, 7]))
    mock.sendRemoteVersion(event('12'))
    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    const bases: unknown[] = []
    mock.override('api.save', (payload) => {
      bases.push((payload as { etag?: string }).etag)
      return { ok: true, file: { ...mock.openPayload('f1').file, etag: '13', revision: '13' } }
    })
    expect((await api.saveDocx(delivered[0]!.path, buf([6]), false)).ok).toBe(true)
    expect(bases).toEqual(['12'])
  })

  it('dirty: the content is not replaced and the warn bar shows', async () => {
    const delivered: OpenFileResult[] = []
    await bootRevision('10')
    api.onOpenDocx((r) => {
      if ('dataUrl' in r) delivered.push(r)
    })
    guardDirty(true)
    mock.sendRemoteVersion(event('12'))
    await flush()
    expect(mock.calls.filter((c) => c.type === 'api.open')).toHaveLength(0)
    expect(delivered).toEqual([])
    expect(barText()).toBe(wt('uwRemoteNewerDirty', { n: '12' }))
    expect(bar()!.querySelector('[data-action="reload"]')).not.toBeNull()
  })

  it('an AI turn is running: no reload, the AI bar; the turn ends, the version loads', async () => {
    const delivered: OpenFileResult[] = []
    await bootRevision('10')
    api.onOpenDocx((r) => {
      if ('dataUrl' in r) delivered.push(r)
    })
    guardDirty(false)
    serveHead('12', new Uint8Array([0x50, 0x4b, 1]))
    frameAiRun.begin('turn-1')
    mock.sendRemoteVersion(event('12'))
    await flush()
    expect(delivered).toEqual([])
    expect(barText()).toBe(wt('uwRemoteNewerAi', { n: '12' }))
    frameAiRun.end('turn-1')
    await vi.waitFor(() => expect(delivered).toHaveLength(1), { timeout: 4000 })
    frameAiRun.stop()
  })

  it('a save answered 403 (revoked) locks the frame: the bar, then every save is refused without a request', async () => {
    const doc = await bootRevision('10')
    mock.override('api.save', () => Promise.reject(protocolError('forbidden', 'HTTP 403')))
    expect(await api.saveDocx(doc.path, buf([4]), false)).toMatchObject({ ok: false })
    expect(barText()).toBe(wt('uwRemoteRevokedWeb'))
    const calls = mock.calls.filter((c) => c.type === 'api.save').length
    // Save is disabled with the spine sentence
    expect(await api.saveDocx(doc.path, buf([5]), false)).toEqual({
      ok: false,
      error: wt('uwRemoteRevokedWeb'),
    })
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(calls)
    expect(document.getElementById('root')?.hasAttribute('inert') ?? true).toBe(true)
  })

  describe.each([
    ['401', 'unauthorized', 'webSaveUnauthorized'],
    ['403', 'forbidden', 'uwRemoteRevokedWeb'],
    ['410', 'not_found', 'uwRemoteDeleted'],
  ] as const)('a save answered %s', (status, code, key) => {
    const fail = () => Promise.reject(protocolError(code, `HTTP ${status}`))

    it('Save: the bar is the only surface, the reason that means "stay dirty, nothing more to say"', async () => {
      const doc = await bootRevision('10')
      mock.override('api.save', fail)
      expect(await api.saveDocx(doc.path, buf([4]), false)).toEqual({
        ok: false,
        reason: 'external-modified',
      })
      expect(barText()).toBe(wt(key))
    })

    it('Save As and the first save: a result without an error shows no editor toast either', async () => {
      const doc = await bootRevision('10')
      mock.override('api.saveAs', fail)
      expect(await api.saveDocxAs('Copy', buf([4]), doc.path)).toEqual({ ok: false })
      expect(barText()).toBe(wt(key))
    })

    it('the first save of a new document', async () => {
      await bootRevision('10')
      mock.override('api.saveAs', fail)
      expect(await api.saveDocxNew('Untitled', buf([4]))).toEqual({ ok: false })
      expect(barText()).toBe(wt(key))
    })
  })

  it('an error the bar does not own (a 500, the network) keeps the editor toast text', async () => {
    const doc = await bootRevision('10')
    mock.override('api.save', () => Promise.reject(protocolError('internal', 'HTTP 500')))
    expect(await api.saveDocx(doc.path, buf([4]), false)).toEqual({
      ok: false,
      error: wt('webSaveFailedGeneric'),
    })
    expect(bar()).toBeNull()
    mock.override('api.saveAs', () => Promise.reject(protocolError('internal', 'HTTP 500')))
    expect(await api.saveDocxAs('Copy', buf([4]), doc.path)).toMatchObject({
      ok: false,
      error: wt('webSaveFailedGeneric'),
    })
  })

  it('doc.blocked on a dirty frame: the bar and the lock at once, Save and Save As refused, edits kept', async () => {
    const doc = await bootRevision('10')
    guardDirty(true)
    mock.sendBlocked({ document_id: 'f1', reason: 'permission_revoked' })
    expect(barText()).toBe(wt('uwRemoteRevokedWeb'))
    expect(document.getElementById('root')?.hasAttribute('inert') ?? true).toBe(true)
    expect(await api.saveDocx(doc.path, buf([5]), false)).toEqual({
      ok: false,
      error: wt('uwRemoteRevokedWeb'),
    })
    expect((await api.saveDocxAs('Copy', buf([5]), doc.path)).ok).toBe(false)
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
    expect(mock.calls.filter((c) => c.type === 'api.save' || c.type === 'api.saveAs')).toEqual([])
    // the frame never reverts the editor's edits: nothing was re-opened
    expect(mock.calls.filter((c) => c.type === 'api.open')).toEqual([])
  })

  it('doc.blocked with an organisation reason: the bar only, the editor usable, Save still reaches the host', async () => {
    const doc = await bootRevision('10')
    guardDirty(true)
    mock.sendBlocked({ document_id: 'f1', reason: 'organization_suspended' })
    expect(barText()).toBe(wt('uwRemoteOrgBlockedWeb', { reason: wt('uwReasonSuspended') }))
    expect(document.getElementById('root')?.hasAttribute('inert') ?? false).toBe(false)
    expect((await api.saveDocx(doc.path, buf([5]), false)).ok).toBe(true)
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(1)
  })

  it('doc.blocked deleted on a clean frame: the delete bar, a not_found answer to the host', async () => {
    await bootRevision('10')
    guardDirty(false)
    mock.sendBlocked({ document_id: 'f1', reason: 'document_deleted' })
    expect(barText()).toBe(wt('uwRemoteDeleted'))
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
  })

  it('a save answered 410 (deleted): the delete bar and a not_found answer to the host', async () => {
    const doc = await bootRevision('10')
    mock.override('api.save', () => {
      throw Object.assign(protocolError('internal', 'HTTP 410'), { status: 410 })
    })
    await api.saveDocx(doc.path, buf([4]), false)
    expect(barText()).toBe(wt('uwRemoteDeleted'))
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
  })

  it('a save answered 401: the sign-in-again bar, no lock', async () => {
    const doc = await bootRevision('10')
    mock.override('api.save', () => Promise.reject(protocolError('unauthorized', 'HTTP 401')))
    await api.saveDocx(doc.path, buf([4]), false)
    expect(barText()).toBe(wt('webSaveUnauthorized'))
    mock.clearOverrides()
    expect((await api.saveDocx(doc.path, buf([5]), false)).ok).toBe(true)
  })

  it('an Overwrite refused for an organisation reason leaves the organisation bar behind', async () => {
    const doc = await bootRevision('10')
    api.onCloseSaveRequest(() => {
      void api.saveDocx(doc.path, buf([4])).then((r) => api.reportCloseSaveResult(r.ok))
    })
    mock.bumpRemote('f1')
    const res = mock.host.save({ reason: 'user' })
    await choose('conflict', 'overwrite')
    mock.override('api.save', () =>
      Promise.reject(
        Object.assign(protocolError('forbidden', 'HTTP 403'), {
          details: { apiCode: 'organization_suspended' },
        }),
      ),
    )
    await choose('conflict', 'go')
    await choose('conflict', 'close')
    expect(await res).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(barText()).toBe(wt('uwRemoteOrgBlockedWeb', { reason: wt('uwReasonSuspended') }))
  })
})

describe('the comments version notifier (G8-12 §3.3)', () => {
  it('the open file and every landed save reach frameDocVersion; only the save is announced', async () => {
    const heard: unknown[] = []
    const off = frameDocVersion.onSaved((saved) => heard.push(saved))
    try {
      const doc = await bootWith()
      expect(frameDocVersion.current()).toEqual({ path: doc.path, versionId: 'v1' })
      expect(heard).toEqual([])
      expect(await api.saveDocx(doc.path, buf([9]), false)).toEqual({ ok: true })
      expect(heard).toEqual([{ path: doc.path, versionId: 'v2' }])
      expect(frameDocVersion.current()).toEqual({ path: doc.path, versionId: 'v2' })
      // a refused save announces nothing
      mock.bumpRemote('f1')
      const pending = api.saveDocx(doc.path, buf([5]))
      await choose('conflict', 'cancel')
      await pending
      expect(heard).toHaveLength(1)
    } finally {
      off()
    }
  })
})

describe('save size gate (SIZE-F1, UNI-1861)', () => {
  it('warns at warn_ratio and blocks above limits.max_bytes before any api.save request', async () => {
    const meta = mock.seed('Report.docx', DOCX)
    mock.init({
      documentId: meta.fileId,
      capabilities: { save: true, saveAs: true, download: true },
      open: {
        ...mock.openPayload(meta.fileId),
        limits: { max_bytes: 100, warn_ratio: 0.7 },
      },
    })
    const doc = (await api.consumePendingOpenDocx()) as OpenFileResult

    // 75 B >= 70 B warn threshold: emits size_warning once, renders fallback chip, still saves
    expect(await api.saveDocx(doc.path, new Uint8Array(75).buffer)).toEqual({ ok: true })
    expect(mock.sizeWarnings).toEqual([{ bytes: 75, max_bytes: 100, warn_ratio: 0.7 }])
    expect(document.querySelector('[data-office-web="size-warning"]')).not.toBeNull()
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(1)

    // 120 B > 100 B max_bytes: blocks before api.save, emits save_blocked, fallback dialog downloads
    const blocked = await api.saveDocx(doc.path, new Uint8Array(120).buffer)
    expect(blocked).toEqual({ ok: false, reason: 'external-modified' })
    expect(document.querySelector('[data-office-web="save-blocked"]')).not.toBeNull()
    expect(mock.saveBlocked).toEqual([{ bytes: 120, max_bytes: 100 }])
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(1)

    document
      .querySelector<HTMLButtonElement>(
        '[data-office-web="save-blocked"] [data-choice="download"]',
      )!
      .click()
    await vi.waitFor(() =>
      expect(mock.calls.filter((c) => c.type === 'api.download')).toHaveLength(1),
    )

    // Save As and Save New also return handled { ok: false } without an error string
    expect(await api.saveDocxAs('Copy.docx', new Uint8Array(120).buffer, doc.path)).toEqual({
      ok: false,
    })
    expect(await api.saveDocxNew('New.docx', new Uint8Array(120).buffer)).toEqual({
      ok: false,
    })

    // Host-initiated save settles with too_large error while renderer receives handled result
    api.onCloseSaveRequest(() => {
      void api
        .saveDocx(doc.path, new Uint8Array(120).buffer)
        .then((r) => api.reportCloseSaveResult(r.ok))
    })
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'too_large' },
    })
  })
})

describe('open_refused and refuse-tier guard (SIZE-F1)', () => {
  it('reportOpenRefused emits one open_refused (no error event), marks uniworkState readOnly, blocks all saves, and resets on another documentId', async () => {
    const opened = await bootWith('Huge.docx')
    api.reportOpenRefused({
      path: opened.path,
      reason: 'too_large_to_open',
      bytes: DOCX.byteLength,
      measure: {
        kind: 'characters',
        value: 26_250_000,
        limit: 25_300_000,
      },
      message: 'Document is too large to open in the editor',
    })
    // Duplicate report for the same documentId is deduplicated
    api.reportOpenRefused({
      path: opened.path,
      reason: 'engine_out_of_memory',
      bytes: DOCX.byteLength,
      message: 'Out of memory',
    })
    expect(mock.openRefused).toEqual([
      {
        reason: 'too_large_to_open',
        bytes: DOCX.byteLength,
        measure: {
          kind: 'characters',
          value: 26_250_000,
          limit: 25_300_000,
        },
      },
    ])
    // no host `error` for a Docs refusal: open_refused is the signal
    expect(mock.errors).toEqual([])
    expect((await api.uniworkState(opened.path)).readOnly).toBe(true)
    expect(await api.saveDocx(opened.path, buf([1]), false)).toMatchObject({ ok: false })
    expect(await api.saveDocxAs('Copy.docx', buf([1]), opened.path)).toMatchObject({ ok: false })
    expect(await api.saveDocxNew('Untitled.docx', buf([1]))).toMatchObject({ ok: false })
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'too_large' },
    })
    expect(await mock.host.saveAs({ name: 'Copy.docx' })).toMatchObject({
      ok: false,
      error: { code: 'too_large' },
    })
    expect(mock.calls.filter((c) => c.type === 'api.save' || c.type === 'api.saveAs')).toEqual([])
    // d2-7: while fatal is set, File > New is blocked (confirmDocumentReplace is false)
    expect(await api.confirmDocumentReplace()).toBe(false)

    // Opening another documentId resets the fatal state and allows saving
    const secondMeta = mock.seed('Valid.docx', DOCX)
    let secondOpen!: OpenFileResult
    const off = api.onOpenDocx((r) => {
      if ('dataUrl' in r) secondOpen = r
    })
    await mock.host.open(mock.openPayload(secondMeta.fileId))
    off()
    expect(secondOpen.name).toBe('Valid.docx')
    expect(mock.openRefused).toHaveLength(1)
    expect((await api.uniworkState(secondOpen.path)).readOnly).toBe(false)
    expect(await api.confirmDocumentReplace()).toBe(true)
    expect(await api.saveDocx(secondOpen.path, buf([7]), false)).toEqual({ ok: true })
  })
})

describe('FRAME-RO-01: capability flags and readOnly profile (UNI-1876)', () => {
  it('webCapabilities defaults save/saveAs/exportPdf/exportHtml to false and hostGrants maps them from init.capabilities', () => {
    expect(webCapabilities).toMatchObject({
      save: false,
      saveAs: false,
      exportPdf: false,
      exportHtml: false,
    })
    expect(
      hostGrants({
        save: true,
        saveAs: true,
        exportPdf: true,
        exportHtml: true,
      }),
    ).toMatchObject({
      save: true,
      saveAs: true,
      exportPdf: true,
      exportHtml: true,
    })
    expect(hostGrants({})).toMatchObject({
      save: false,
      saveAs: false,
      exportPdf: false,
      exportHtml: false,
    })
  })

  it('refuses saveAs without the saveAs grant even when save is granted', async () => {
    const doc = await bootWith('Report.docx', { save: true, saveAs: false })
    expect(await mock.host.saveAs({ name: 'Copy.docx' })).toMatchObject({
      ok: false,
      error: { code: 'unsupported' },
    })
    expect(await api.saveDocxAs('Copy.docx', buf([5]), doc.path)).toEqual({
      ok: false,
      error: 'unsupported',
    })
    expect(mock.calls.some((c) => c.type === 'api.saveAs')).toBe(false)
  })

  it('refuses exportPdf without the exportPdf grant and exportHtml without the exportHtml grant', async () => {
    await bootWith('Report.docx', {
      save: true,
      saveAs: true,
      exportPdf: false,
      exportHtml: false,
    })
    expect(await api.exportPdf('Report.docx', 12240, 15840, undefined, 1)).toEqual({
      ok: false,
      error: 'unsupported',
    })
    expect(await api.saveMergedPdf('Merged.pdf', [WEB_PRINT_PART])).toEqual({
      ok: false,
      error: 'unsupported',
    })
    expect(await api.exportHtml('Report.docx', '<p>x</p>')).toEqual({
      ok: false,
      error: 'unsupported',
    })
    expect(await mock.host.print({ mode: 'pdf' })).toEqual({ printed: false })
    expect(mock.calls.some((c) => c.type === 'api.export')).toBe(false)
  })

  it('host Print runs on the print grant alone: no exportPdf grant needed (RFW2-1)', async () => {
    await bootWith('Report.docx', { save: true, print: true, exportPdf: false })
    expect(await mock.host.print({})).toEqual({ printed: true })
    expect(window.print).toHaveBeenCalledTimes(1)
    // the Export PDF entry stays refused without its own grant
    expect(await api.exportPdf('Report.docx', 12240, 15840, undefined, 1)).toEqual({
      ok: false,
      error: 'unsupported',
    })
  })

  it('readOnly profile forces view-only, refuses save/saveAs/exportHtml even when granted, and keeps granted print and exportPdf', async () => {
    const meta = mock.seed('Report.docx', DOCX)
    mock.init({
      documentId: meta.fileId,
      profile: 'readOnly',
      capabilities: {
        save: true,
        saveAs: true,
        print: true,
        exportPdf: true,
        exportHtml: true,
      },
    })
    const doc = (await api.consumePendingOpenDocx()) as OpenFileResult
    expect(await api.uniworkState(doc.path)).toEqual({ bound: false, readOnly: true })
    expect(await api.saveDocx(doc.path, buf([1]), false)).toEqual({
      ok: false,
      error: 'read-only document',
    })
    expect(await api.saveDocxAs('Copy.docx', buf([1]), doc.path)).toEqual({
      ok: false,
      error: 'read-only document',
    })
    expect(await api.saveDocxNew('New.docx', buf([1]))).toEqual({
      ok: false,
      error: 'read-only document',
    })
    expect(await mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'unsupported' },
    })
    expect(await mock.host.saveAs({ name: 'Copy.docx' })).toMatchObject({
      ok: false,
      error: { code: 'unsupported' },
    })
    expect(await api.exportHtml('Report.docx', '<p>x</p>')).toEqual({
      ok: false,
      error: 'unsupported',
    })
    // D3: granted print and exportPdf stay available in readOnly profile
    expect(await api.exportPdf('Report.docx', 12240, 15840, undefined, 1)).toEqual({
      ok: true,
      path: 'Report.pdf',
    })
    expect(await mock.host.print({ mode: 'dialog' })).toEqual({ printed: true })
  })
})

describe('RFSH-5: File > Save a copy on a locked-out tab (UNI-1920)', () => {
  /** the new web-only DesktopApi member (absent until the green commit) */
  type WithSaveCopy = WebApi & {
    saveDocxCopy?(): Promise<
      { ok: true; title: string } | { ok: false; error?: string; reason?: 'cancelled' }
    >
  }
  const copy = () => (api as WithSaveCopy).saveDocxCopy!()

  it('sends api.saveCopy with the live document bytes and the localized "<name> (copy)" title', async () => {
    await bootWith('Report.docx', { saveCopy: true })
    api.provideDocBytes(async () => buf([3, 1, 4]))
    await expect(copy()).resolves.toEqual({ ok: true, title: 'Report (copy)' })
    const calls = mock.calls.filter((c) => c.type === 'api.saveCopy')
    expect(calls).toHaveLength(1)
    const sent = calls[0]!.payload as { data: ArrayBuffer; name: string }
    expect(new Uint8Array(sent.data)).toEqual(new Uint8Array([3, 1, 4]))
    expect(sent.name).toBe('Report (copy)')
    // the open document is not re-pointed and nothing else was written
    expect(mock.saved).toEqual([])
    expect(mock.bytesOf('f1')).toEqual(DOCX)
  })

  it('is not gated on save or writable: a locked-out tab and a writable:false file still copy', async () => {
    // save:false + saveCopy:true (the locked-out grant) — isViewOnly() is true here by design
    await bootWith('Report.docx', { save: false, saveCopy: true })
    api.provideDocBytes(async () => buf([9]))
    await expect(copy()).resolves.toMatchObject({ ok: true })
    expect(mock.calls.filter((c) => c.type === 'api.saveCopy')).toHaveLength(1)

    // a host-marked non-writable file under an editing tab keeps the same gate
    setup()
    const meta = mock.seed('Locked.docx', DOCX)
    mock.rename(meta.fileId, 'Locked.docx', { writable: false })
    mock.init({ documentId: meta.fileId, capabilities: { save: true, saveCopy: true } })
    await api.consumePendingOpenDocx()
    api.provideDocBytes(async () => buf([8]))
    await expect(copy()).resolves.toMatchObject({ ok: true })
  })

  it('refuses under the readOnly profile even when the host granted saveCopy', async () => {
    const meta = mock.seed('Report.docx', DOCX)
    mock.init({
      documentId: meta.fileId,
      profile: 'readOnly',
      capabilities: { save: true, saveCopy: true },
    })
    await api.consumePendingOpenDocx()
    api.provideDocBytes(async () => buf([1]))
    await expect(copy()).resolves.toEqual({ ok: false, error: 'read-only document' })
    expect(mock.calls.some((c) => c.type === 'api.saveCopy')).toBe(false)
  })

  it('refuses without the saveCopy grant and when the live document cannot be serialized', async () => {
    await bootWith('Report.docx', { save: false })
    await expect(copy()).resolves.toEqual({ ok: false, error: 'unsupported' })
    expect(mock.calls.some((c) => c.type === 'api.saveCopy')).toBe(false)

    // granted, but the renderer never registered provideDocBytes: no bytes, no request
    setup()
    await bootWith('Report.docx', { saveCopy: true })
    await expect(copy()).resolves.toMatchObject({ ok: false })
    expect(mock.calls.some((c) => c.type === 'api.saveCopy')).toBe(false)
  })
})

describe('UNI-1920 item B: Ctrl/Cmd+P inside the Docs frame runs File > Print', () => {
  const pressP = (init: KeyboardEventInit = {}): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { key: 'p', cancelable: true, ...init })
    window.dispatchEvent(ev)
    return ev
  }

  it('mod+P dispatches the renderer\'s "print" menu command (the in-frame print dialog)', async () => {
    await bootWith('Report.docx', { save: true, print: true })
    const commands: string[] = []
    api.onMenuCommand((cmd) => commands.push(cmd))
    pressP({ ctrlKey: true })
    pressP({ metaKey: true })
    expect(commands).toEqual(['print', 'print'])
  })

  it('does nothing while the print grant is withheld (the browser keeps its default)', async () => {
    await bootWith('Report.docx', { save: true })
    const commands: string[] = []
    api.onMenuCommand((cmd) => commands.push(cmd))
    pressP({ ctrlKey: true })
    expect(commands).toEqual([])
  })
})
