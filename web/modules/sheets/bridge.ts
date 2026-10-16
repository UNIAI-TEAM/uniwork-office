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
 * |                                             | 'conflict' (frame or host save) -> ../shared/conflict-dialog.ts; the host |
 * |                                             | `save` gets its outcome (ok / ok w/o versionId / cancelled / error code)  |
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
 * | writeWorkbookRecovery                       | draft recovery (C18): transport.serialize of the renderer's 30 s recovery |
 * |                                             | payload, kept in memory and written encrypted to IndexedDB at once        |
 * |                                             | (../../docs/bridge/draft-recovery.ts); never api.save, no session swap.   |
 * |                                             | The boot document's draft is offered (shared prompt) before it opens;     |
 * |                                             | Restore opens the draft bytes `restoredFromRecovery`, dirty until saved   |
 * | onRecoveryPrompt / replyRecoveryPrompt      | no-ops: the shared draft prompt is the only recovery UI on the web        |
 * | AI (aiStream, aiChat, getAiSettings,        | the stubs below answer while AI is off; installModuleBridge swaps in the  |
 * | webSearch, imageSearch, generateImage, ...) | shared web AI bridge (modules/shared/ai withWebAi) while the host grants  |
 * |                                             | `ai` (CONTRACT C16): frame-token AI routes, streamed in the frame         |
 * | fetchImage                                  | data: URLs decoded locally; else image.fetch (host proxy, SSRF-guarded)   |
 * | createDocument, readLocalImage,             | desktop-only, never granted: typed "unavailable" answers, so the AI tools |
 * | openWorkbooksForMerge, autoRenameWorkbook   | that need them are not offered (renderer ai/skill-gate.ts)                |
 * | everything else (screenshot, merge,         | typed stubs, hidden by capability keys (../capabilities.ts)               |
 * | autosave, headless, attachments)            |                                                                           |
 *
 * View-only: without the host's `save` grant every save is refused (the renderer hides Save, see
 * apps/sheets/src/renderer/capabilities.ts). An engine that is not installed answers
 * `engine-unavailable`: the bridge reports it to the host once (`error` {code:'unsupported'},
 * non-fatal: the frame shows its own styled screen) and the renderer shows that screen.
 */
import {
  toProtocolError,
  type Capabilities,
  type FileMeta,
  type FileSource,
  type OpenPayload,
  type OpenRefusedMeasure,
  type OpenRefusedReason,
  type ProtocolErrorShape,
  type SaveResult,
} from '../../docs/protocol/types'
import aiStubs from '../../docs/bridge/ai'
import { downloadBlob, openExternal as guardedExternal } from '../../docs/bridge/browser'
import { TIMEOUTS, errorCode } from '../../docs/bridge/frame-port'
import { ownHeadAfterUnknown } from '../../docs/bridge/head-match'
import type { ModuleBridgePort } from '../../docs/bridge/module-bridge'
import { decodeDataUrl, idFromPath, pathFor } from '../../docs/bridge/webapi'
import type { DraftHost, DraftRecovery } from '../../docs/bridge/draft-recovery'
import { bridgeDraftRecovery } from '../shared/recovery-prompt'
import { bindLagDetectorPort, documentMounted, queueDocumentLoaded } from '../shared/lag-detector'
import { createRemoteVersion, type RemoteVersion, type SaveFailure } from '../shared/remote-version'
import { saveFailureDetail } from '../shared/save-failure'
import { createSaveSizeGate } from '../shared/save-size-gate'
import {
  conflictSaveResult,
  bridgeDownloadCap,
  downloadVia,
  headFromFile,
  overwriteHead,
  readHeadFile,
  revisionOf,
  runConflictDialog,
  type ConflictIo,
  type ConflictOutcome,
} from '../shared/conflict-dialog'
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
import { ask as domAsk, notifySavedReopenFailed, text, type AskFn } from './notice'
import { frameDocVersion } from '../shared/comments/doc-version'
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

function classifyOpenRefusal(err: unknown): {
  reason: OpenRefusedReason
  measure?: OpenRefusedMeasure
  details?: Record<string, unknown>
} | null {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'too_large') {
    const { worksheetXmlBytes, limitBytes } = err as {
      worksheetXmlBytes?: unknown
      limitBytes?: unknown
    }
    const hasMeasure =
      typeof worksheetXmlBytes === 'number' &&
      Number.isFinite(worksheetXmlBytes) &&
      typeof limitBytes === 'number' &&
      Number.isFinite(limitBytes)
    return {
      reason: 'too_large_to_open',
      ...(hasMeasure
        ? {
            measure: {
              kind: 'worksheet_xml_bytes',
              value: worksheetXmlBytes,
              limit: limitBytes,
            },
            details: { worksheetXmlBytes, limitBytes },
          }
        : {}),
    }
  }
  const msg = describe(err)
  if (code === 'engine_out_of_memory' || /out of memory/i.test(msg)) {
    return { reason: 'engine_out_of_memory' }
  }
  const zipParts = /(?:zip|xlsx) rejected:\s*(\d+)\s*parts exceeds the\s*(\d+)\s*limit/i.exec(msg)
  if (zipParts) {
    return {
      reason: 'too_complex',
      measure: {
        kind: 'zip_parts',
        value: Number(zipParts[1]),
        limit: Number(zipParts[2]),
      },
    }
  }
  if (/Workbook contains too many ZIP entries/i.test(msg)) {
    return { reason: 'too_complex' }
  }
  if (/(?:zip|xlsx) rejected:/i.test(msg)) {
    // declared / inflated size gates of the zip reader (no part count measure)
    return { reason: 'too_large_to_open' }
  }
  return null
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
  /** the save conflict dialog (default: ../shared/conflict-dialog.ts); injectable for tests */
  conflict?: (io: ConflictIo) => Promise<ConflictOutcome>
  print?: (html: string) => Promise<{ ok: boolean; error?: string }>
  download?: (name: string, blob: Blob) => void
  /** UI language for the engine's number/date display (default: <html lang>) */
  locale?: () => string
  /** how long the renderer may take to start a host-requested save / save-as (ms) */
  editorStartMs?: number
  /** how long a host-requested save may run (ms) */
  saveTimeoutMs?: number
  /** draft recovery (C18; default: IndexedDB + the shared prompt); injectable for tests */
  drafts?: (host: DraftHost) => DraftRecovery
}

interface Session {
  fileId: string | null
  name: string
}

const NOT_AVAILABLE = 'Not available in the web build'

export function createSheetsWebApi(port: ModuleBridgePort, opts: SheetsWebApiOptions) {
  const { transport, capabilities } = opts
  const ask = opts.ask ?? domAsk
  const conflictDialog = opts.conflict ?? runConflictDialog
  const print = opts.print ?? printHtml
  const download = opts.download ?? downloadBlob
  const locale = opts.locale ?? (() => document.documentElement.lang || 'en')
  const editorStartMs = opts.editorStartMs ?? TIMEOUTS.editorStart
  const saveTimeoutMs = opts.saveTimeoutMs ?? 180_000

  /** set while the current document open was refused for size/complexity/OOM (cleared when another document opens) */
  let refusedError: ProtocolErrorShape | null = null
  /** documentIds already reported through `open_refused` */
  const refusedIds = new Set<string>()

  /** renderer-level keys the host grants switch on (./capabilities.ts sheetsHostGrants) */
  const granted = (key: 'open' | 'save' | 'saveAs') => capabilities[key] === true
  const canSave = () => granted('save') && refusedError === null

  /** fileId -> latest server metadata (etag = If-Match base of the next save) */
  const files = new Map<string, FileMeta>()
  const sessions = new Map<string, Session>()
  let current: string | null = null
  let dirty = false
  /** the "new version on UniWork" bar and its reload / lock rules (G5-03w); created below the save plumbing */
  let remote: RemoteVersion | undefined = undefined

  // ------------------------------------------------------------ draft recovery (C18)

  /** the document `init` names: the only one the host's draft scope ("<user>:<document>") covers */
  let initDocumentId: string | null = null
  /** the effective capabilities from `init` (`download` for the conflict dialog) */
  let effective: Capabilities | undefined
  /** `init.downloadMaxBytes`: the largest file the host's `api.download` accepts (X-02 r2b) */
  const downloadCap = bridgeDownloadCap(port)
  port
    .whenInitialized()
    .then((s) => {
      initDocumentId = s.documentId
      effective = s.capabilities
    })
    .catch(() => {})
  /** the document whose draft is being offered (before it is opened) */
  let offering: FileMeta | null = null
  /** the latest recovery bytes the renderer's 30 s timer produced, per session */
  let latest: { sessionId: string; data: ArrayBuffer } | null = null
  /** set by the prompt's Restore while `offering` */
  let restoredDraft: ArrayBuffer | null = null
  /**
   * The open workbook came from a draft: its edits live in the session bytes, not in the
   * renderer's journal, so it stays dirty (whatever notifyPendingEdits says) until a save lands.
   */
  let restored = false

  const drafts = (opts.drafts ?? ((host) => bridgeDraftRecovery(port, 'sheets', host)))({
    file: () => {
      const meta = offering ?? (current !== null ? files.get(current) : undefined)
      return meta && meta.fileId === initDocumentId
        ? { ...(meta.etag ? { etag: meta.etag } : {}), name: meta.name }
        : null
    },
    isDirty: () => dirty,
    bytes: async () => {
      const session = latest ? sessions.get(latest.sessionId) : undefined
      return latest && session && session.fileId === current ? latest.data : null
    },
    restore: (bytes) => {
      restoredDraft = bytes
    },
  })

  /** the draft of `file` the user chose to restore, or null (no draft, Discard, not ours) */
  async function offerDraft(file: FileMeta): Promise<ArrayBuffer | null> {
    if (file.fileId !== initDocumentId || !canSave()) return null
    restoredDraft = null
    offering = file
    try {
      await drafts.opened()
    } finally {
      offering = null
    }
    const data = restoredDraft
    restoredDraft = null
    return data
  }

  function remember(file: FileMeta): void {
    files.set(file.fileId, { ...files.get(file.fileId), ...file })
    current = file.fileId
    // G8-12: the comments anchor base follows the open file (open, reload, adopted head, save)
    const meta = files.get(file.fileId)!
    frameDocVersion.noteOpened({ path: pathFor(meta), versionId: meta.versionId ?? null })
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

  /** the queued workbook is the conflict "Reload latest": no draft offer */
  let reloadWithoutDraft = false
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

  /** the workbook the renderer shows last (inspection hook for e2e / diagnostics) */
  let shown: WorkbookFile | null = null

  function decorate(file: WorkbookFile, meta: FileMeta, fromDraft = false): WorkbookFile {
    shown = {
      ...file,
      name: meta.name,
      path: pathFor(meta),
      readOnly: !canSave(),
      // a view-only frame is a UniWork view-only workbook: the AI then reads and answers but never
      // edits (isUniworkViewOnly). An editing frame stays unbound: Save keeps following pending edits
      ...(canSave() ? {} : { uniworkBound: true }),
      // the renderer then sends restoreWriteBack on Save and stands its recovery timer down
      ...(fromDraft ? { restoredFromRecovery: true } : {}),
    }
    return shown
  }

  const sizeGate = createSaveSizeGate({
    port,
    getLiveBytes: () => {
      const session = latest ? sessions.get(latest.sessionId) : undefined
      return latest && session && session.fileId === current ? latest.data : null
    },
    persistDraft: () => drafts.flush(),
    frame: { markerAttr: 'data-sheets-web' },
  })

  /** `offer`: false for the conflict "Reload latest" (the user just discarded the edits) */
  async function openPayload(payload: OpenPayload, offer = true): Promise<WorkbookFile> {
    const server = await readSource(payload.source)
    const draft = offer ? await offerDraft(payload.file) : null
    // the engine may take ownership of the buffer: open a copy of the draft
    const data = draft ? copyBuffer(draft) : server
    let opened: WorkbookFile
    try {
      opened = await transport.open({ name: payload.file.name, data, locale: locale() })
    } catch (err) {
      if (isEngineUnavailable(err)) reportEngineUnavailable()
      else {
        const refusal = classifyOpenRefusal(err)
        if (refusal) {
          const message = describe(err)
          // at most once per documentId per session (contract §3.1a)
          if (!refusedIds.has(payload.file.fileId)) {
            refusedIds.add(payload.file.fileId)
            port.reportOpenRefused?.({
              reason: refusal.reason,
              bytes: server.byteLength,
              ...(refusal.measure ? { measure: refusal.measure } : {}),
            })
          }
          // `details` lets the host say why in one sentence ("this workbook holds about N MB of
          // sheet data, above the N MB the web editor opens"): sizes in bytes, JSON-safe numbers
          const fatalError: ProtocolErrorShape = {
            code: 'too_large',
            message,
            ...(refusal.details ? { details: refusal.details } : {}),
          }
          refusedError = fatalError
          current = null
          sessions.clear()
          shown = null
          latest = null
          restored = false
          dirty = false
          port.setDirty(false)
          port.reportError(fatalError, true)
          if (err && typeof err === 'object' && !('code' in err)) {
            Object.assign(err, { code: 'too_large' })
          }
        }
      }
      throw err
    }
    refusedError = null
    // another workbook: the pending version and the bar of the old one are gone
    if (current !== null && current !== payload.file.fileId) remote?.reset()
    sizeGate.noteDocumentOpened(payload.file.fileId, payload.limits)
    remember(payload.file)
    sessions.set(opened.sessionId, { fileId: payload.file.fileId, name: payload.file.name })
    restored = draft !== null
    latest = draft ? { sessionId: opened.sessionId, data: draft } : null
    dirty = restored
    port.setDirty(dirty)
    remote?.dirtyChanged(dirty)
    bindLagDetectorPort(port, effective)
    queueDocumentLoaded(payload.file.fileId, data.byteLength)
    return decorate(opened, payload.file, restored)
  }

  /** before another workbook replaces this one: unsaved edits need an explicit discard */
  async function mayReplace(): Promise<boolean> {
    if (!dirty) return true
    const choice = await ask({
      title: 'appWebDiscardTitle',
      body: 'appWebDiscardBody',
      choices: [
        { id: 'cancel', label: 'appWebCancel', primary: true },
        { id: 'discard', label: 'appWebDiscard', danger: true },
      ],
      cancelId: 'cancel',
      marker: 'discard',
    })
    return choice === 'discard'
  }

  // The desktop's File accelerators come from the native menu (sheets-main.ts menu:action); in the
  // frame the same keys drive the same renderer actions, and the browser's own "save page" /
  // "open file" / "print page" dialogs never appear over the workbook.
  if (typeof document !== 'undefined') {
    document.addEventListener(
      'keydown',
      (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return
        const key = event.key.toLowerCase()
        const action: MenuAction | null =
          key === 's'
            ? event.shiftKey
              ? granted('saveAs') && refusedError === null
                ? 'save-as'
                : null
              : canSave()
                ? 'save'
                : null
            : key === 'o' && !event.shiftKey && granted('open')
              ? 'open'
              : key === 'p' && !event.shiftKey
                ? 'print'
                : null
        if (key === 's' || key === 'o' || key === 'p') event.preventDefault()
        if (action && runMenu(action)) event.stopPropagation()
      },
      true,
    )
  }

  port.handleOpen(async (payload) => {
    queued = async () => payload
    reloadWithoutDraft = false
    runMenu('open')
    return { opened: true, title: payload.file.name }
  })

  // ------------------------------------------------------------ save plumbing

  /** set while the host's `save` request runs the renderer's save flow */
  let hostSave: {
    error: ProtocolErrorShape | null
    /** the conflict dialog's answer (overwritten / reloaded / cancelled / failed) */
    answer: SaveResult | null
  } | null = null
  /** stops the host save's renderer timer (the conflict dialog may stay open for long) */
  let holdRendererSave: (() => void) | null = null
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
        holdRendererSave = null
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), saveTimeoutMs)
      holdRendererSave = () => clearTimeout(timer)
      closeSaveWaiters.push(finish)
      for (const handler of [...closeSaveHandlers]) handler()
    })
  }

  /** the answer of a save the frame refuses because the document was revoked / deleted */
  function lockedSave(): SaveResult | null {
    const lock = remote?.locked()
    if (!lock) return null
    return {
      ok: false,
      error: {
        code: lock === 'revoked' ? 'forbidden' : 'not_found',
        message: remote!.lockText(),
      },
    }
  }

  port.handleSave(async () => {
    if (refusedError) return { ok: false, error: refusedError }
    const locked = lockedSave()
    if (locked) return locked
    if (!canSave()) return { ok: false, error: { code: 'forbidden', message: 'view-only' } }
    if (!current) return { ok: false, error: { code: 'not_ready', message: 'no workbook is open' } }
    if (hostSave)
      return { ok: false, error: { code: 'busy', message: 'a save is already running' } }
    hostSave = { error: null, answer: null }
    try {
      const ok = await runRendererSave()
      if (hostSave.answer) return hostSave.answer
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
    if (refusedError) return { ok: false, error: refusedError }
    const locked = lockedSave()
    if (locked) return locked
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
      // the status and details (a 403's reason) go with it: the new-version bar reads them
      return { ok: false, error: toProtocolError(err).toShape() }
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

  /**
   * A save that hit `conflict` (frame-initiated or the host's `save`): the shared conflict dialog
   * settles it in the frame; the host's `save` gets the outcome as its answer (hostSave.answer).
   */
  async function resolveConflict(fileId: string, data: ArrayBuffer): Promise<Landed> {
    holdRendererSave?.()
    const outcome = await conflictDialog({
      title: text('appWebConflictTitle'),
      body: text('appWebConflictBody'),
      reloadLabel: text('appWebConflictReload'),
      overwriteLabel: text('appWebConflictOverwrite'),
      cancelLabel: text('appWebCancel'),
      baseRevision: revisionOf(files.get(fileId)),
      readHead: async () => headFromFile(await readHeadFile(port, fileId)),
      overwrite: () => overwriteHead(port, fileId, data),
      reload: async () => {
        // the latest version replaces the workbook; the renderer re-runs its open flow. The edits
        // are discarded on purpose, so their draft goes too and the reopen offers nothing.
        const head = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.transfer })
        remember(head.file)
        queued = async () => head
        reloadWithoutDraft = true
        void drafts.saved()
        dirty = false
        restored = false
        runMenu('open')
        return true
      },
      canEdit: canSave,
      download: downloadVia(port, effective, () => data, {
        size: data.byteLength,
        maxBytes: downloadCap(),
      }),
      sizeBytes: data.byteLength,
      maxBytes: sizeGate.limits().max_bytes,
      markerAttr: 'data-sheets-web',
    })
    const file = files.get(fileId)
    if (hostSave && file) hostSave.answer = conflictSaveResult(outcome, file)
    if (outcome.kind === 'overwritten') return { file: outcome.file ?? file! }
    if (outcome.kind === 'reloaded') return { canceled: true }
    if (outcome.kind === 'failed') {
      return failSave({
        code: outcome.code,
        message: '',
        ...(outcome.apiCode ? { details: { apiCode: outcome.apiCode } } : {}),
      })
    }
    throw new Error(text('appWebConflictNotSaved'))
  }

  /** api.save of the current file, conflicts resolved */
  async function saveInPlace(fileId: string, data: ArrayBuffer): Promise<Landed> {
    const gate = await sizeGate.checkBeforeSave(data)
    if (!gate.allowed) {
      if (hostSave) hostSave.error = gate.error
      throw new Error(gate.message)
    }
    const res = await putSave(fileId, data)
    if (res.ok) return { file: res.file }
    if (hostSave) hostSave.error = res.error
    if (res.error.code === 'too_large') {
      throw new Error(sizeGate.handleServerTooLarge(res.error, data))
    }
    if (res.error.code === 'conflict') {
      // the host's own `save` waits for the dialog's answer instead of an error event
      if (!hostSave) port.reportError(res.error, false)
      return resolveConflict(fileId, data)
    }
    if (res.error.code === 'timeout' || res.error.code === 'network') {
      // the save may have landed: adopt the head when it holds exactly our bytes
      const head = await ownHeadAfterUnknown(port, fileId, files.get(fileId)?.etag, data)
      if (head) remember(head)
    }
    return failSave(res.error)
  }

  /**
   * a transport failure ("Failed to fetch") is browser jargon: the localized sentence alone says
   * it; any other failure adds the shared localized sentence of its status, never the host's raw
   * English status line ("Internal Server Error")
   */
  function saveFailure(error: SaveFailure & { message: string }): Error {
    const detail = saveFailureDetail(error)
    return new Error(detail ? `${text('appWebSaveFailed')} ${detail}` : text('appWebSaveFailed'))
  }

  /**
   * A failed save. A 401 / 403 / 410 gets the new-version bar (G5-03w), which is then the only
   * surface: the save ends as cancelled, so the editor shows no error toast on top of the bar.
   * Any other failure throws and the editor reports it.
   */
  function failSave(error: SaveFailure & { message: string }): Landed {
    if (remote?.saveFailed(error)) return { canceled: true }
    throw saveFailure(error)
  }

  async function saveAsNew(
    name: string,
    data: ArrayBuffer,
    sourceFileId: string | null,
  ): Promise<Landed> {
    const pending = hostSaveAs
    pending?.started()
    const gate = await sizeGate.checkBeforeSave(data)
    if (!gate.allowed) {
      pending?.settle({ ok: false, error: gate.error })
      throw new Error(gate.message)
    }
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
    if (res.error.code === 'too_large') {
      throw new Error(sizeGate.handleServerTooLarge(res.error, data))
    }
    return failSave(res.error)
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

  // ------------------------------------------------------------ new version on UniWork (G5-03w, S6)

  remote = createRemoteVersion({
    port,
    current: () =>
      current === null ? null : { fileId: current, revision: revisionOf(files.get(current)) },
    isDirty: () => dirty,
    canEdit: canSave,
    // a clean reload hands the renderer the head through its open flow, like the conflict dialog's
    // Reload latest (nothing is dirty, so no draft is offered)
    apply: async (reply) => {
      remember(reply.file)
      queued = async () => reply
      reloadWithoutDraft = true
      runMenu('open')
    },
    // the renderer's latest recovery copy (30 s tick) is the only live serialization of a dirty workbook
    download: () =>
      downloadVia(port, effective, () => {
        const session = latest ? sessions.get(latest.sessionId) : undefined
        if (!latest || !session || session.fileId !== current) {
          throw new Error('no copy of the open workbook is available')
        }
        return latest.data
      }),
    frame: { markerAttr: 'data-sheets-web' },
  })

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
      const offer = !reloadWithoutDraft
      queued = null
      reloadWithoutDraft = false
      if (next) return openPayload(await next(), offer)
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

    noteDocumentMounted(): void {
      documentMounted()
    },
    // merge sources need multi-pick + extra sessions: hidden on the web (C11, mergeWorkbooks); the
    // AI's merge tool (chat attachments) is not offered either (renderer ai/skill-gate.ts)
    selectWorkbooksForMerge: async () => null,
    openWorkbooksForMerge: async () => null,

    // ---- engine ------------------------------------------------------------
    readWorkbookRange: (request) => transport.readRange(request),
    readWorkbookFormulas: (request) => transport.readFormulaCells(request),
    readWorkbookMedia: (request) => transport.readMedia(request),
    // Find & Replace scan and the row outline read: the same sidecar commands as the desktop
    findWorkbookCells: (request) =>
      transport.findCells
        ? (transport.findCells(request) as ReturnType<DesktopApi['findWorkbookCells']>)
        : Promise.reject(new Error(`find: ${NOT_AVAILABLE}`)),
    readWorkbookRowOutline: (request) =>
      transport.readRowOutline
        ? (transport.readRowOutline(request) as ReturnType<DesktopApi['readWorkbookRowOutline']>)
        : Promise.reject(new Error(`row outline: ${NOT_AVAILABLE}`)),
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
      if (refusedError) {
        hostSaveAs?.settle({ ok: false, error: refusedError })
        throw new Error(refusedError.message)
      }
      if (remote?.locked()) throw new Error(remote.lockText())
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
      sizeGate.noteSaveSucceeded()
      const saved = files.get(meta.fileId)!
      frameDocVersion.noteSaved({ path: pathFor(saved), versionId: saved.versionId ?? null })
      port.reportSaved({
        file: files.get(meta.fileId)!,
        ...(meta.versionId ? { versionId: meta.versionId } : {}),
        initiatedByFrame: hostSave === null && hostSaveAs === null,
      })
      let swapped: WorkbookFile | null = null
      let swapFailure: unknown = null
      try {
        swapped = await transport.replaceSession({
          sessionId: request.sessionId,
          name: meta.name,
          data: kept,
          locale: locale(),
        })
      } catch (err) {
        swapFailure = err
      }
      // the version exists whether or not the engine could reopen it: the edits landed
      dirty = false
      restored = false
      latest = null
      port.setDirty(false)
      // the scope's drafts are obsolete
      void drafts.saved()
      if (!swapped) {
        // the host has the bytes, so a retry would only write the same version again: say so
        notifySavedReopenFailed()
        throw swapFailure instanceof Error
          ? swapFailure
          : new Error(text('appWebSavedReopenFailed'))
      }
      sessions.delete(request.sessionId)
      sessions.set(swapped.sessionId, { fileId: meta.fileId, name: meta.name })
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

    /**
     * The renderer's 30 s recovery tick (cap 'recoveryCopy'): the bytes a save would write, kept
     * in this frame and stored as an encrypted draft (C18). Never api.save, never a version
     * (C10), no session swap: the open session keeps its bytes. Only the boot document has a
     * draft scope; anything else answers ok:false (the renderer skips the tick).
     */
    async writeWorkbookRecovery(input: WorkbookSaveRequest): Promise<{ ok: boolean }> {
      // consume a chunked transfer first: it must not linger whatever happens next
      const request = resolveTransfer(input)
      const session = sessions.get(request.sessionId)
      if (!canSave() || !session || session.fileId === null || session.fileId !== initDocumentId)
        return { ok: false }
      const { data } = await transport.serialize(request)
      // a save or another open landed meanwhile: these bytes are stale
      if (!sessions.has(request.sessionId) || !dirty) return { ok: false }
      latest = { sessionId: request.sessionId, data }
      await drafts.flush()
      return { ok: true }
    },
    // the desktop recovery dialog never shows: the shared draft prompt is the web's only UI
    onRecoveryPrompt: noopDisposer,
    replyRecoveryPrompt: () => {},
    // post-AI rename of a desktop file: the web document keeps the name the user chose
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
      // a restored draft has an empty journal but unsaved content; a view-only frame (no save
      // grant) can never hold unsaved work, so it never tells the host it is dirty
      dirty = canSave() && (count > 0 || restored)
      port.setDirty(dirty)
      remote?.dirtyChanged(dirty)
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
    // AI image tools hand over data: URLs (generation) or https URLs (search): the host proxy
    // fetches the latter (a page cannot: connect-src 'self')
    async fetchImage(url: string): Promise<{ base64: string; mime: string } | null> {
      if (typeof url !== 'string' || !url) return null
      if (url.startsWith('data:')) return decodeDataUrl(url)
      if (!/^https?:\/\//i.test(url)) return null
      try {
        const res = await port.request('image.fetch', { url }, { timeoutMs: TIMEOUTS.short })
        return res?.image ?? null
      } catch {
        return null
      }
    },
    generateImage: async () => ({ error: NOT_AVAILABLE }),
    pickAttachments: async () => null,
    addAttachmentPaths: async () => ({ accepted: [], rejected: [] }),
    addPastedImage: async () => ({ accepted: [], rejected: [] }),
    readAttachment: async () => ({ ok: false, error: NOT_AVAILABLE }),
    readAttachmentImage: async () => ({ ok: false, error: NOT_AVAILABLE }),
    getPathForFile: (_file: File) => '',
    // printing is the browser dialog: no printer list; the page follows the UI theme
    listPrinters: async () => [],
    getDocumentTheme: async () => 'follow' as const,

    // threaded-comment author: the signed-in UniWork user from the handshake ('' before it / none)
    getUserDisplayName: async () => {
      const session = await port.whenInitialized()
      return session.user?.displayName ?? ''
    },
  } satisfies Partial<DesktopApi>

  return {
    desktopApi,
    /** test/inspection hooks */
    state: {
      isDirty: () => dirty,
      currentFileId: () => current,
      sessionCount: () => sessions.size,
      file: (fileId: string) => files.get(fileId),
      /** the current session: id, name and sheet ids (no cell data) */
      workbook: () =>
        shown && sessions.has(shown.sessionId)
          ? {
              sessionId: shown.sessionId,
              name: shown.name,
              needsSaveAs: shown.needsSaveAs === true,
              sheets: shown.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name })),
            }
          : null,
      toProtocolError,
    },
  }
}

export type SheetsWebApi = ReturnType<typeof createSheetsWebApi>
