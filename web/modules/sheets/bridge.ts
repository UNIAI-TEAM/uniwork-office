/**
 * window.desktopApi for the Sheets web frame (UNI-1016), over the frame protocol (web/docs/protocol)
 * and the engine seam (./engine/transport.ts). Desktop source of truth: apps/sheets/src/preload/
 * index.ts + apps/sheets/src/main/sheets-main.ts; classification: docs/web-modules/sheets-sidecar.md
 * section 7.
 *
 * | desktopApi                                  | web                                                                       |
 * |---------------------------------------------|---------------------------------------------------------------------------|
 * | hasQueuedWorkbook                           | true once `init` arrived (the host always opens one document)             |
 * | selectWorkbook                              | boot: init.open / api.open {documentId}; host `open`; conflict reload;    |
 * |                                             | File > Open: file.pick (only with the filePick grant) -> transport.open   |
 * | readWorkbookRange / Formulas / Media        | transport (engine)                                                        |
 * | readPivotDefinition / recalcWorkbook        | transport, only when the engine has the feature (else rejected: hidden)   |
 * | saveWorkbookEdits                           | transport.serialize -> api.save {fileId, data, etag} (never `auto`, C10)  |
 * |                                             | or api.saveAs {name, data, sourceFileId}; then transport.replaceSession  |
 * |                                             | 'conflict' -> Overwrite / Reload latest / Cancel (./notice.ts)            |
 * | begin/send/abortSaveEditsTransfer           | in-frame accumulator (no IPC hop to batch around)                         |
 * | closeWorkbook                               | transport.close                                                           |
 * | notifyPendingEdits                          | `dirty` event                                                             |
 * | onWorkbookRenamed                           | host `file.renamed`                                                       |
 * | onMenuAction                                | host `open` / `saveAs` / `print` requests drive the renderer's actions    |
 * | onCloseSaveRequest / reportCloseSaveResult  | host `save` request runs the renderer's save flow                         |
 * | printWorkbook / exportPdf                   | the laid-out HTML printed in a hidden srcdoc frame (print dialog; no      |
 * |                                             | server HTML->PDF route in v1, lane decision B4-5)                         |
 * | exportCsv                                   | browser download (UTF-8 BOM, like the desktop write)                      |
 * | openExternal                                | guarded window.open (http/s, noopener)                                    |
 * | everything else (AI, recovery, screenshot,  | typed stubs, hidden by capability keys (../capabilities.ts)               |
 * | merge, autosave, headless, attachments)     |                                                                           |
 *
 * View-only: without the host's `save` grant every save is refused (the renderer hides Save, see
 * apps/sheets/src/renderer/capabilities.ts). An engine that is not installed answers
 * `engine-unavailable`: the bridge reports it to the host once (`error` {code:'unsupported'},
 * non-fatal: the frame shows its own styled screen) and the renderer shows that screen.
 */
import {
  toProtocolError,
  type FileMeta,
  type FileSource,
  type OpenPayload,
  type ProtocolErrorShape,
  type SaveResult,
} from '../../docs/protocol/types'
import aiStubs from '../../docs/bridge/ai'
import { downloadBlob, openExternal as guardedExternal } from '../../docs/bridge/browser'
import { TIMEOUTS, errorCode } from '../../docs/bridge/frame-port'
import type { ModuleBridgePort } from '../../docs/bridge/module-bridge'
import { idFromPath, pathFor } from '../../docs/bridge/webapi'
import type {
  DesktopApi,
  MenuAction,
  WorkbookCellEdit,
  WorkbookFile,
  WorkbookSaveEditsAbort,
  WorkbookSaveEditsBegin,
  WorkbookSaveEditsChunk,
  WorkbookSaveRequest,
  WorkbookSaveResult,
} from '../../../apps/sheets/src/shared/desktop-api'
import { ask as domAsk, text, type AskFn } from './notice'
import { isEngineUnavailable, type SheetsEngineTransport } from './engine/transport'

export { pathFor, idFromPath }

/** file types the Sheets frame opens (legacy .xls only when the engine converts it) */
export function acceptedExtensions(transport: SheetsEngineTransport): string[] {
  return transport.features.xlsImport ? ['xlsx', 'xlsm', 'xls'] : ['xlsx', 'xlsm']
}

/** "Report.xlsx" / "Report" -> "Report.<ext>" */
export function withExt(name: string, ext: string): string {
  return name.replace(/\.(xlsx|xlsm|xls|csv|pdf)$/i, '') + ext
}

/** detached copy: neither side may keep a view on a buffer the other transfers */
function copyBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const out = new ArrayBuffer(src.byteLength)
  new Uint8Array(out).set(src)
  return out
}

async function readSource(source: FileSource): Promise<ArrayBuffer> {
  if (source.kind === 'bytes') return copyBuffer(source.data)
  const res = await fetch(source.url, { credentials: 'omit', headers: source.headers })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  return res.arrayBuffer()
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Print laid-out HTML (the renderer's print/PDF pipeline output) through the browser dialog from
 * a hidden `srcdoc` frame: its own window.print() prints only that document. `srcdoc` frames are
 * not blocked by the frame CSP's `frame-src 'none'` (measured, inventory-b4 C-6) and inherit its
 * script-free policy, which the print HTML does not need.
 */
export function printHtml(html: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none'
    let done = false
    const finish = (result: { ok: boolean; error?: string }) => {
      if (done) return
      done = true
      setTimeout(() => frame.remove(), 0)
      resolve(result)
    }
    frame.addEventListener('load', () => {
      const win = frame.contentWindow
      if (!win) return finish({ ok: false, error: 'print frame unavailable' })
      win.addEventListener('afterprint', () => finish({ ok: true }))
      try {
        win.focus()
        win.print()
        // Chromium blocks inside print(); others return at once and fire afterprint later
        setTimeout(() => finish({ ok: true }), 60_000)
      } catch (err) {
        finish({ ok: false, error: describe(err) })
      }
    })
    frame.srcdoc = html
    document.body.append(frame)
  })
}

export interface SheetsWebApiOptions {
  transport: SheetsEngineTransport
  /** the shared capability object (host grants land in it on `init`) */
  capabilities: Readonly<Record<string, unknown>>
  /** in-frame choice dialog (default: ./notice.ts); injectable for tests */
  ask?: AskFn
  print?: (html: string) => Promise<{ ok: boolean; error?: string }>
  download?: (name: string, blob: Blob) => void
  /** UI language for the engine's number/date display (default: <html lang>) */
  locale?: () => string
  /** how long the renderer may take to start a host-requested save / save-as (ms) */
  editorStartMs?: number
  /** how long a host-requested save may run (ms) */
  saveTimeoutMs?: number
}

interface Session {
  fileId: string | null
  name: string
}

const NOT_AVAILABLE = 'Not available in the web build'

export function createSheetsWebApi(port: ModuleBridgePort, opts: SheetsWebApiOptions) {
  const { transport, capabilities } = opts
  const ask = opts.ask ?? domAsk
  const print = opts.print ?? printHtml
  const download = opts.download ?? downloadBlob
  const locale = opts.locale ?? (() => document.documentElement.lang || 'en')
  const editorStartMs = opts.editorStartMs ?? TIMEOUTS.editorStart
  const saveTimeoutMs = opts.saveTimeoutMs ?? 180_000

  /** renderer-level keys the host grants switch on (./capabilities.ts sheetsHostGrants) */
  const granted = (key: 'open' | 'save' | 'saveAs') => capabilities[key] === true
  const canSave = () => granted('save')

  /** fileId -> latest server metadata (etag = If-Match base of the next save) */
  const files = new Map<string, FileMeta>()
  const sessions = new Map<string, Session>()
  let current: string | null = null
  let dirty = false

  function remember(file: FileMeta): void {
    files.set(file.fileId, { ...files.get(file.fileId), ...file })
    current = file.fileId
  }

  // ------------------------------------------------------------ engine availability

  let engineReported = false
  function reportEngineUnavailable(): void {
    if (engineReported) return
    engineReported = true
    // non-fatal: the frame shows its own styled screen; the host may offer its fallback
    port.reportError(
      {
        code: 'unsupported',
        message: 'engine-unavailable: no workbook engine in this frame build',
      },
      false,
    )
  }
  if (transport.kind === 'unavailable') {
    port
      .whenInitialized()
      .then(reportEngineUnavailable)
      .catch(() => {})
  }

  // ------------------------------------------------------------ open plumbing

  /** the next workbook selectWorkbook() delivers (boot document, host `open`, conflict reload) */
  let queued: (() => Promise<OpenPayload>) | null = async () => {
    const session = await port.whenInitialized()
    return (
      session.open ??
      (await port.request(
        'api.open',
        { fileId: session.documentId },
        { timeoutMs: TIMEOUTS.transfer },
      ))
    )
  }

  const menuListeners = new Set<(action: MenuAction) => void>()
  function runMenu(action: MenuAction): boolean {
    for (const listener of [...menuListeners]) listener(action)
    return menuListeners.size > 0
  }

  function decorate(file: WorkbookFile, meta: FileMeta): WorkbookFile {
    return { ...file, name: meta.name, path: pathFor(meta), readOnly: !canSave() }
  }

  async function openPayload(payload: OpenPayload): Promise<WorkbookFile> {
    const data = await readSource(payload.source)
    let opened: WorkbookFile
    try {
      opened = await transport.open({ name: payload.file.name, data, locale: locale() })
    } catch (err) {
      if (isEngineUnavailable(err)) reportEngineUnavailable()
      // above the frame's size gate: fatal, so the host opens the G3 editor instead (C11)
      else if ((err as { code?: unknown })?.code === 'too_large') {
        port.reportError({ code: 'too_large', message: describe(err) }, true)
      }
      throw err
    }
    remember(payload.file)
    sessions.set(opened.sessionId, { fileId: payload.file.fileId, name: payload.file.name })
    return decorate(opened, payload.file)
  }

  /** before another workbook replaces this one: unsaved edits need an explicit discard */
  async function mayReplace(): Promise<boolean> {
    if (!dirty) return true
    const choice = await ask({
      title: 'appWebDiscardTitle',
      body: 'appWebDiscardBody',
      choices: [
        { id: 'cancel', label: 'appWebCancel', primary: true },
        { id: 'discard', label: 'appWebDiscard' },
      ],
      cancelId: 'cancel',
      marker: 'discard',
    })
    return choice === 'discard'
  }

  port.handleOpen(async (payload) => {
    queued = async () => payload
    runMenu('open')
    return { opened: true, title: payload.file.name }
  })

  // ------------------------------------------------------------ save plumbing

  /** set while the host's `save` request runs the renderer's save flow */
  let hostSave: { error: ProtocolErrorShape | null } | null = null
  /** set while the host's `saveAs` request waits for the renderer to reach saveWorkbookEdits */
  let hostSaveAs: { name?: string; settle: (r: SaveResult) => void; started: () => void } | null =
    null

  const closeSaveHandlers = new Set<() => void>()
  let closeSaveWaiters: Array<(ok: boolean) => void> = []

  function runRendererSave(): Promise<boolean> {
    if (closeSaveHandlers.size === 0) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer)
        closeSaveWaiters = closeSaveWaiters.filter((w) => w !== finish)
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), saveTimeoutMs)
      closeSaveWaiters.push(finish)
      for (const handler of [...closeSaveHandlers]) handler()
    })
  }

  port.handleSave(async () => {
    if (!canSave()) return { ok: false, error: { code: 'forbidden', message: 'view-only' } }
    if (!current) return { ok: false, error: { code: 'not_ready', message: 'no workbook is open' } }
    if (hostSave)
      return { ok: false, error: { code: 'busy', message: 'a save is already running' } }
    hostSave = { error: null }
    try {
      const ok = await runRendererSave()
      const file = files.get(current)
      if (ok && file)
        return { ok: true, file, ...(file.versionId ? { versionId: file.versionId } : {}) }
      return {
        ok: false,
        error: hostSave.error ?? { code: 'internal', message: 'save did not complete' },
      }
    } finally {
      hostSave = null
    }
  })

  port.handleSaveAs(async (payload) => {
    if (!granted('saveAs'))
      return { ok: false, error: { code: 'forbidden', message: 'save-as not granted' } }
    if (hostSaveAs)
      return { ok: false, error: { code: 'busy', message: 'a save-as is already running' } }
    return new Promise<SaveResult>((resolve) => {
      const timer = setTimeout(
        () =>
          settle({
            ok: false,
            error: { code: 'timeout', message: 'the editor did not start Save As' },
          }),
        editorStartMs,
      )
      const settle = (r: SaveResult) => {
        clearTimeout(timer)
        hostSaveAs = null
        resolve(r)
      }
      hostSaveAs = {
        ...(payload?.name ? { name: payload.name } : {}),
        settle,
        started: () => clearTimeout(timer),
      }
      if (!runMenu('save-as'))
        settle({ ok: false, error: { code: 'not_ready', message: 'no editor is listening' } })
    })
  })

  port.handlePrint(async (payload) => {
    const started = runMenu(payload?.mode === 'pdf' ? 'export-pdf' : 'print')
    return { printed: started }
  })

  port.handleCloseCheck(() => ({ dirty, autoSave: false }))

  const renameListeners = new Set<(newName: string) => void>()
  port.onFileRenamed((file) => {
    const prev = files.get(file.fileId)
    if (!prev) return
    files.set(file.fileId, { ...prev, ...file })
    for (const session of sessions.values())
      if (session.fileId === file.fileId) session.name = file.name
    if (prev.name !== file.name) for (const listener of [...renameListeners]) listener(file.name)
  })

  /** api.save / api.saveAs: a rejection and an ok:false result are both failures */
  async function sendSave(send: () => Promise<SaveResult>): Promise<SaveResult> {
    try {
      const res = await send()
      if (res?.ok === true && res.file) return res
      if (res?.ok === false) return res
      return { ok: false, error: { code: 'malformed', message: 'unexpected save result' } }
    } catch (err) {
      return { ok: false, error: { code: errorCode(err), message: describe(err) } }
    }
  }

  async function headMeta(fileId: string): Promise<FileMeta | null> {
    try {
      const open = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.short })
      return open?.file?.fileId === fileId ? open.file : null
    } catch {
      return null
    }
  }

  function putSave(fileId: string, data: ArrayBuffer): Promise<SaveResult> {
    const etag = files.get(fileId)?.etag
    const payload = { fileId, data: copyBuffer(data), ...(etag ? { etag } : {}) }
    return sendSave(() =>
      port.request('api.save', payload, { timeoutMs: TIMEOUTS.transfer, transfer: [payload.data] }),
    )
  }

  type Landed = { file: FileMeta } | { canceled: true }

  /** the user chose for a save that hit `conflict` (a host-initiated save gets the error instead) */
  async function resolveConflict(fileId: string, data: ArrayBuffer): Promise<Landed> {
    const choice = await ask({
      title: 'appWebConflictTitle',
      body: 'appWebConflictBody',
      choices: [
        { id: 'cancel', label: 'appWebCancel' },
        { id: 'reload', label: 'appWebConflictReload' },
        { id: 'overwrite', label: 'appWebConflictOverwrite', primary: true },
      ],
      cancelId: 'cancel',
      marker: 'conflict',
    })
    if (choice === 'overwrite') {
      const head = await headMeta(fileId)
      if (head) {
        remember(head)
        const again = await putSave(fileId, data)
        if (again.ok) return { file: again.file }
      }
    } else if (choice === 'reload') {
      // the latest version replaces the workbook; the renderer re-runs its open flow
      queued = () => port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.transfer })
      dirty = false
      runMenu('open')
      return { canceled: true }
    }
    throw new Error(text('appWebConflictNotSaved'))
  }

  /** api.save of the current file, conflicts resolved */
  async function saveInPlace(fileId: string, data: ArrayBuffer): Promise<Landed> {
    const res = await putSave(fileId, data)
    if (res.ok) return { file: res.file }
    if (hostSave) hostSave.error = res.error
    if (res.error.code === 'conflict') {
      port.reportError(res.error, false)
      if (hostSave) throw new Error(res.error.message)
      return resolveConflict(fileId, data)
    }
    if (res.error.code === 'timeout' || res.error.code === 'network') {
      // the save may have landed: adopt the head when it looks like our own write
      const before = files.get(fileId)
      const head = await headMeta(fileId)
      if (head && before?.etag && head.etag !== before.etag && head.sizeBytes === data.byteLength) {
        remember(head)
      }
    }
    throw new Error(`${text('appWebSaveFailed')} (${res.error.message})`)
  }

  async function saveAsNew(
    name: string,
    data: ArrayBuffer,
    sourceFileId: string | null,
  ): Promise<Landed> {
    const pending = hostSaveAs
    pending?.started()
    const payload = {
      name: pending?.name ?? name,
      data: copyBuffer(data),
      ...(sourceFileId ? { sourceFileId } : {}),
    }
    const res = await sendSave(() =>
      port.request('api.saveAs', payload, { timeoutMs: TIMEOUTS.dialog, transfer: [payload.data] }),
    )
    pending?.settle(res)
    if (res.ok) return { file: res.file }
    if (res.error.code === 'cancelled') return { canceled: true }
    throw new Error(`${text('appWebSaveFailed')} (${res.error.message})`)
  }

  // ------------------------------------------------------------ chunked edit transfers

  const transfers = new Map<string, { sessionId: string; edits: WorkbookCellEdit[] }>()

  function resolveTransfer(request: WorkbookSaveRequest): WorkbookSaveRequest {
    if (request.editsTransferId === undefined) return request
    const transfer = transfers.get(request.editsTransferId)
    transfers.delete(request.editsTransferId)
    if (!transfer || transfer.sessionId !== request.sessionId) {
      throw new Error('Unknown or expired save transfer.')
    }
    const { editsTransferId: _consumed, ...rest } = request
    return { ...rest, edits: transfer.edits }
  }

  // ------------------------------------------------------------ desktopApi

  const unavailable = (what: string) => () => Promise.reject(new Error(`${what}: ${NOT_AVAILABLE}`))
  const noopDisposer = () => () => {}

  const desktopApi = {
    ...aiStubs,

    // ---- open --------------------------------------------------------------
    async hasQueuedWorkbook(): Promise<boolean> {
      try {
        await port.whenInitialized()
        return queued !== null
      } catch {
        return false
      }
    },

    async selectWorkbook(): Promise<WorkbookFile | null> {
      const next = queued
      queued = null
      if (next) return openPayload(await next())
      if (!granted('open')) return null
      try {
        const res = await port.request(
          'file.pick',
          { purpose: 'open', accept: acceptedExtensions(transport) },
          { timeoutMs: TIMEOUTS.dialog },
        )
        if (!res?.file || !(await mayReplace())) return null
        return await openPayload(res.file)
      } catch (err) {
        if (isEngineUnavailable(err)) throw err
        if (errorCode(err) !== 'cancelled') console.error('[sheets-web] file.pick failed:', err)
        return null
      }
    },

    // merge sources need multi-pick + extra sessions: hidden on the web (C11, mergeWorkbooks)
    selectWorkbooksForMerge: async () => null,
    openWorkbooksForMerge: async () => null,

    // ---- engine ------------------------------------------------------------
    readWorkbookRange: (request) => transport.readRange(request),
    readWorkbookFormulas: (request) => transport.readFormulaCells(request),
    readWorkbookMedia: (request) => transport.readMedia(request),
    readPivotDefinition: (request) =>
      capabilities.pivotRefresh === false
        ? Promise.reject(new Error(`pivot refresh: ${NOT_AVAILABLE}`))
        : transport.readPivotDefinition(request),
    recalcWorkbook: (request) =>
      capabilities.recalcFallback === false
        ? Promise.reject(new Error(`recalculation fallback: ${NOT_AVAILABLE}`))
        : transport.recalc(request),
    async closeWorkbook(sessionId: string): Promise<void> {
      sessions.delete(sessionId)
      for (const [id, t] of transfers) if (t.sessionId === sessionId) transfers.delete(id)
      await transport.close(sessionId)
    },

    // ---- save --------------------------------------------------------------
    async saveWorkbookEdits(input: WorkbookSaveRequest): Promise<WorkbookSaveResult> {
      if (!canSave() || (input.mode === 'save-as' && !granted('saveAs'))) {
        hostSaveAs?.settle({ ok: false, error: { code: 'forbidden', message: 'view-only' } })
        throw new Error(text('appWebViewOnly'))
      }
      const request = resolveTransfer(input)
      const session = sessions.get(request.sessionId)
      if (!session) throw new Error('Unknown workbook session.')
      const { data, touchedEntries } = await transport.serialize(request)
      // the bytes are transferred to the host: keep our own copy for the session swap
      const kept = copyBuffer(data)
      const landed: Landed =
        request.mode === 'save' && session.fileId !== null && !hostSaveAs
          ? await saveInPlace(session.fileId, data)
          : await saveAsNew(
              withExt(session.name, /\.xlsm$/i.test(session.name) ? '.xlsm' : '.xlsx'),
              data,
              session.fileId,
            )
      if ('canceled' in landed) return { canceled: true }
      const meta = landed.file
      remember(meta)
      port.reportSaved({
        file: files.get(meta.fileId)!,
        ...(meta.versionId ? { versionId: meta.versionId } : {}),
        initiatedByFrame: hostSave === null && hostSaveAs === null,
      })
      const swapped = await transport.replaceSession({
        sessionId: request.sessionId,
        name: meta.name,
        data: kept,
        locale: locale(),
      })
      sessions.delete(request.sessionId)
      sessions.set(swapped.sessionId, { fileId: meta.fileId, name: meta.name })
      dirty = false
      port.setDirty(false)
      return { canceled: false, file: decorate(swapped, meta), touchedEntries }
    },

    async beginSaveEditsTransfer(request: WorkbookSaveEditsBegin): Promise<void> {
      if (!sessions.has(request.sessionId)) throw new Error('Unknown workbook session.')
      transfers.set(request.transferId, { sessionId: request.sessionId, edits: [] })
    },
    async sendSaveEditsChunk(request: WorkbookSaveEditsChunk): Promise<void> {
      const transfer = transfers.get(request.transferId)
      if (!transfer || transfer.sessionId !== request.sessionId) {
        throw new Error('Unknown save transfer.')
      }
      const edits = JSON.parse(request.editsJson) as WorkbookCellEdit[]
      for (const edit of edits) transfer.edits.push(edit)
    },
    async abortSaveEditsTransfer(request: WorkbookSaveEditsAbort): Promise<void> {
      transfers.delete(request.transferId)
    },

    // no crash-recovery copy and no autosave on the web (CONTRACT C10)
    writeWorkbookRecovery: async (_request: WorkbookSaveRequest) => ({ ok: false }),
    onRecoveryPrompt: noopDisposer,
    replyRecoveryPrompt: () => {},
    autoRenameWorkbook: async (_sessionId: string, _baseName: string) => ({ renamed: false }),

    // ---- export / print ----------------------------------------------------
    async exportPdf(request) {
      const r = await print(request.html)
      return r.ok
        ? { canceled: false as const, path: `${withExt(request.fileName, '.pdf')} (print dialog)` }
        : { canceled: true as const }
    },
    async printWorkbook(request) {
      const r = await print(request.html)
      return r.ok
        ? { ok: true as const }
        : { ok: false as const, ...(r.error ? { error: r.error } : {}) }
    },
    async exportCsv(request) {
      const name = withExt(request.fileName, '.csv')
      download(name, new Blob(['﻿', request.content], { type: 'text/csv;charset=utf-8' }))
      return { canceled: false as const, path: name }
    },
    // CSV sessions do not exist in the frame (the host opens xlsx documents)
    confirmCsvSave: async () => 'xlsx' as const,
    createDocument: async () => ({ ok: false, error: NOT_AVAILABLE }),

    // ---- session events ----------------------------------------------------
    openExternal: async (url: string) => {
      guardedExternal(url)
    },
    onMenuAction(callback: (action: MenuAction) => void): () => void {
      menuListeners.add(callback)
      return () => {
        menuListeners.delete(callback)
      }
    },
    onWorkbookRenamed(callback: (newName: string) => void): () => void {
      renameListeners.add(callback)
      return () => {
        renameListeners.delete(callback)
      }
    },
    notifyPendingEdits(count: number): void {
      dirty = count > 0
      port.setDirty(dirty)
    },
    onCloseSaveRequest(callback: () => void): () => void {
      closeSaveHandlers.add(callback)
      return () => {
        closeSaveHandlers.delete(callback)
      }
    },
    reportCloseSaveResult(ok: boolean): void {
      for (const waiter of closeSaveWaiters.slice()) waiter(ok)
    },

    // ---- launch handshakes / headless (desktop shell only) -----------------
    consumeNewBlankWorkbook: async () => false,
    consumeAiPreset: async () => null,
    onAiPreset: noopDisposer,
    consumeHeadlessExport: async () => null,
    headlessExportDone: () => {},
    onChromePressed: noopDisposer,

    // ---- desktop-only inputs (hidden: screenshot, ai) ----------------------
    readLocalImage: unavailable('local image'),
    captureScreenSources: async () => ({ status: 'denied' as const, sources: [] }),
    captureScreenSource: async () => null,
    fetchImage: async () => null,
    generateImage: async () => ({ error: NOT_AVAILABLE }),
    pickAttachments: async () => null,
    addAttachmentPaths: async () => ({ accepted: [], rejected: [] }),
    addPastedImage: async () => ({ accepted: [], rejected: [] }),
    readAttachment: async () => ({ ok: false, error: NOT_AVAILABLE }),
    readAttachmentImage: async () => ({ ok: false, error: NOT_AVAILABLE }),
    getPathForFile: (_file: File) => '',
  } satisfies Partial<DesktopApi>

  return {
    desktopApi,
    /** test/inspection hooks */
    state: {
      isDirty: () => dirty,
      currentFileId: () => current,
      sessionCount: () => sessions.size,
      file: (fileId: string) => files.get(fileId),
      toProtocolError,
    },
  }
}

export type SheetsWebApi = ReturnType<typeof createSheetsWebApi>
