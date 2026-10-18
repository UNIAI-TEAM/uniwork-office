/**
 * WEB-API class (GO-B3, UNI-1013): the part of DesktopApi that needs UniWork,
 * implemented over the frame protocol (web/docs/protocol, types.ts). The frame
 * holds no cookies and no UniWork credentials of its own: every server call is
 * an `api.*` request to the host page, which proxies it with its frame token
 * (apiMode 'host-proxy'). Desktop source of truth:
 * apps/docs/src/main/docs-main.ts (`docs:*` handlers) and apps/docs/src/preload/index.ts.
 *
 * | DesktopApi method         | protocol                                                                         |
 * |---------------------------|----------------------------------------------------------------------------------|
 * | consumePendingOpenDocx    | init.open, else api.open {fileId: init.documentId} (once, at boot)               |
 * | onOpenDocx                | host request `open` {file, source} -> listeners -> {opened, title}                |
 * | openDocxPath(path)        | `uniwork://files/<id>/<name>` -> api.open {fileId}                                |
 * | openDocx                  | file.pick {purpose:'open'} (UniWork picker in the host); null = cancelled        |
 * | saveDocx(path,data,auto)  | api.save {fileId, data, etag, auto}; 'conflict' -> see "Save conflicts" below    |
 * | saveDocxAs                | api.saveAs {name, data, sourceFileId} (host dialog); 'cancelled' -> {ok:false}   |
 * | saveDocxNew               | api.saveAs {name, data, silent: true} (first save of an untitled document)       |
 * | getRecentFiles            | api.recents {limit} -> `uniwork://files/<id>/<name>` paths                        |
 * | exportPdf                 | api.export {format:'pdf', fileId, data (live bytes when dirty)} -> download; failure -> window.print |
 * | provideDocBytes           | App.tsx registers the live-document serializer exportPdf uses when dirty        |
 * | printPdfBuffer / saveMergedPdf | deferred marker parts -> one exportPdf of the current file                  |
 * | exportHtml                | renderer-built HTML -> browser download (no server needed)                       |
 * | onRenamedDocx             | host event file.renamed {file}                                                   |
 * | fetchImage(url)           | data: URLs decoded locally; else image.fetch (server-side SSRF-guarded proxy)    |
 * | convertAltChunkHtml       | convert.altChunkHtml; failure -> null (altChunk skipped, as on a failed convert) |
 * | onCloseCheck & co, onMenuCommand | ./session.ts: `dirty` / `title` events, host `doc.closeCheck` / `save` / `saveAs` |
 * | projectApi.*              | ./project-memory.ts (AI-only; AI is hidden on the web)                           |
 * | draft recovery (C18)      | ./draft-recovery.ts: encrypted IndexedDB copy of provideDocBytes every 30 s while |
 * |                           | dirty; offered before the renderer loads (Restore = `recovered`, starts dirty)    |
 * Every successful save emits `saved` {file, versionId, initiatedByFrame}.
 *
 * Save conflicts (the host answers `conflict`: someone saved a newer version). Every manual save
 * that hits it, the frame's own and the host's `save {reason}`, opens the one conflict dialog
 * (../../modules/shared/conflict-dialog.ts): Reload latest (api.open replaces the document),
 * Overwrite… (re-read the head etag with api.open, save again; a second conflict asks again),
 * Cancel (stays dirty). A frame-initiated save also tells the host with an `error` event
 * {code:'conflict', fatal:false}; the host's `save` gets the outcome as its answer instead
 * (conflictSaveResult: ok with/without versionId, cancelled, unauthorized / forbidden /
 * not_found / internal). An autosave never prompts.
 * A timed-out / network-failed save may still have landed: the bridge re-reads the head and
 * adopts its etag when it looks like our own write (see reconcileAfterUnknown).
 *
 * Opening another document (File > Open, recents) over unsaved edits asks first. A fatal open
 * failure (no host, init timeout, api.open error) shows a blocking notice and every save is
 * refused until the host opens a document again.
 *
 * Host -> frame requests handled here: `open`, `save` (runs the editor's full
 * save flow), `saveAs` (runs the editor's Save As with the host's name),
 * `print` ({mode:'pdf'} = server export, else the in-frame print dialog).
 *
 * Not here on purpose: AI / search / image generation (./ai.ts, stubbed +
 * hidden), attachments (./browser.ts keeps them in the browser; AI-panel only),
 * doc passwords (./hide.ts). Encrypted (CFB) docx is passed through as-is.
 */
import type {
  DesktopApi,
  OpenDocxResult,
  OpenFileResult,
  PdfExportResult,
} from '../../../apps/docs/src/shared/ipc'
import {
  isReadOnlyProfile,
  toProtocolError,
  type Capabilities,
  type FileMeta,
  type FileSource,
  type OpenPayload,
  type ProtocolErrorShape,
  type SaveResult,
} from '../protocol/types'
import { TIMEOUTS, errorCode, type FramePort } from './frame-port'
import { ownHeadAfterUnknown } from './head-match'
import { downloadBlob, printFrame } from './browser'
import { buildDiff, diffFailure } from './conflict-diff'
import { ask, conflictFrame, hideFatal, onModalChange, showFatal, text } from './notice'
import {
  conflictSaveResult,
  bridgeDownloadCap,
  downloadVia,
  headFromFile,
  overwriteHead,
  readHeadFile,
  revisionOf,
  runConflictDialog,
  saveCopyVia,
} from '../../modules/shared/conflict-dialog'
import { createSession, type SessionOptions } from './session'
import type { DraftHost, DraftRecovery } from './draft-recovery'
import { bridgeDraftRecovery } from '../../modules/shared/recovery-prompt'
import {
  bindLagDetectorPort,
  documentMounted,
  queueDocumentLoaded,
} from '../../modules/shared/lag-detector'
import { saveFailureText } from '../../modules/shared/save-failure'
import { createRemoteVersion, type RemoteVersion } from '../../modules/shared/remote-version'
import { createSaveSizeGate } from '../../modules/shared/save-size-gate'
import { projectApi } from './project-memory'
import { mintDocHandoff, releaseDocHandoff } from './doc-handoff'
import { frameDocVersion } from '../../modules/shared/comments/doc-version'

// ---------------------------------------------------------------- paths

const PATH_PREFIX = 'uniwork://files/'

/** the renderer treats a path as opaque and shows `path.split(/[\\/]/).pop()` */
export function pathFor(file: { fileId: string; name: string }): string {
  return `${PATH_PREFIX}${file.fileId}/${file.name}`
}

/** file id of a bridge path, null for anything else */
export function idFromPath(path: string | null | undefined): string | null {
  if (typeof path !== 'string' || !path.startsWith(PATH_PREFIX)) return null
  const rest = path.slice(PATH_PREFIX.length)
  const slash = rest.indexOf('/')
  return slash > 0 ? rest.slice(0, slash) : null
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** "Report.docx" / "Report" -> "Report.<ext>" */
function withExt(name: string, ext: string): string {
  return name.replace(/\.(docx|pdf|html?)$/i, '') + ext
}

// ---------------------------------------------------------------- bytes

/** detached copy: neither side may keep a view on a buffer the other transfers */
function copyBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const out = new ArrayBuffer(src.byteLength)
  new Uint8Array(out).set(src)
  return out
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // crypto.subtle needs a secure context (https / localhost)
    return ''
  }
}

/** bytes inline, or a signed URL fetched without cookies */
async function readSource(source: FileSource): Promise<ArrayBuffer> {
  if (source.kind === 'bytes') return copyBuffer(source.data)
  const res = await fetch(source.url, { credentials: 'omit', headers: source.headers })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  return res.arrayBuffer()
}

export function decodeDataUrl(url: string): { base64: string; mime: string } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(url)
  if (!m) return null
  const mime = m[1] || 'text/plain'
  if (m[3]) return { base64: m[4], mime }
  try {
    let bin = ''
    for (const b of new TextEncoder().encode(decodeURIComponent(m[4])))
      bin += String.fromCharCode(b)
    return { base64: btoa(bin), mime }
  } catch {
    return null
  }
}

function failure(code: ProtocolErrorShape['code'], message: string): SaveResult {
  return { ok: false, error: { code, message } }
}

/** a rejected request or an ok:false SaveResult, as one shape */
function saveError(err: unknown): ProtocolErrorShape {
  // the status and details (a 403's reason) go with it: the new-version bar reads them
  return toProtocolError(err).toShape()
}

const READ_ONLY = 'read-only document'

/** printPdfBuffer has no bytes on web; saveMergedPdf recognises this marker */
export const WEB_PRINT_PART = 'web-print-deferred'

export interface WebApiOptions {
  session?: SessionOptions
  /** the in-frame print (default: browser.ts printFrame); injectable for tests */
  print?: (scale?: number) => Promise<{ ok: boolean; error?: string }>
  /** draft recovery (C18; default: IndexedDB + the shared prompt); injectable for tests */
  drafts?: (host: DraftHost) => DraftRecovery
}

// ---------------------------------------------------------------- factory

export function createWebApi(port: FramePort, opts: WebApiOptions = {}) {
  /** fileId -> latest server metadata (etag = If-Match base of the next save) */
  const files = new Map<string, FileMeta>()
  /** fileId -> last opened byte length (for open_refused reporting) */
  const fileSizes = new Map<string, number>()
  /** documentIds already reported through `open_refused` (once per documentId) */
  const refusedIds = new Set<string>()
  /** the document this frame shows (save / export target) */
  let current: string | null = null
  /** the host's effective grants from `init` (undefined until the handshake, and in unit-test sessions) */
  let grants: Capabilities | undefined
  /** `init.profile === 'readOnly'`: forces view-only regardless of capabilities (UNI-1876) */
  let readOnlyProfile = false
  /** `init.downloadMaxBytes`: the largest file the host's `api.download` accepts (X-02 r2b) */
  const downloadCap = bridgeDownloadCap(port)

  /**
   * View-only (protocol README "Read-only documents"): the host set `profile: 'readOnly'`, withheld
   * the `save` grant, or marked the file `writable: false`. Without a grants object (unit-test
   * sessions) nothing is withheld unless `readOnlyProfile` is set.
   */
  function isViewOnly(fileId?: string | null): boolean {
    if (readOnlyProfile) return true
    if (grants !== undefined && grants.save !== true) return true
    return fileId ? files.get(fileId)?.writable === false : false
  }

  function canSaveAs(): boolean {
    return !readOnlyProfile && (grants === undefined || grants.saveAs === true)
  }

  function canExportPdf(): boolean {
    return grants === undefined || grants.exportPdf === true
  }

  function canExportHtml(): boolean {
    return !readOnlyProfile && (grants === undefined || grants.exportHtml === true)
  }
  /** the "new version on UniWork" bar and its reload / lock rules (G5-03w); created below, once the open plumbing exists */
  let remote: RemoteVersion | undefined = undefined
  const session = createSession(
    {
      // the bar follows the editor's dirty state (dirty <-> "undone all changes")
      setDirty: (dirty, o) => {
        port.setDirty(dirty, o)
        remote?.dirtyChanged(dirty)
      },
      setTitle: (title) => port.setTitle(title),
      handleCloseCheck: (handler) => port.handleCloseCheck(handler),
    },
    opts.session,
  )
  // the frame dialogs only dim the iframe: tell the host so it can dim its own chrome
  onModalChange((open) => port.setModal?.(open))

  // ------------------------------------------------------------ draft recovery (C18)

  /** the document `init` names: the only one the host's draft scope ("<user>:<document>") covers */
  let initDocumentId: string | null = null
  let restoredDraft: ArrayBuffer | null = null
  const drafts = (opts.drafts ?? ((host) => bridgeDraftRecovery(port, 'docs', host)))({
    file: () => {
      const file =
        fatal === null && current !== null && current === initDocumentId
          ? files.get(current)
          : undefined
      return file ? { etag: file.etag, name: file.name } : null
    },
    isDirty: () => fatal === null && session.isDirty(),
    bytes: () => liveDocBytes(),
    restore: (bytes) => {
      restoredDraft = bytes
    },
  })

  /**
   * Offer the document's draft before the renderer loads it (like the desktop's recovery copy):
   * Restore opens the draft bytes as `recovered` (the renderer starts dirty, the user saves).
   */
  async function withDraft(result: OpenFileResult): Promise<OpenFileResult> {
    restoredDraft = null
    await drafts.opened()
    const data = restoredDraft
    restoredDraft = null
    if (!data) return result
    // the server bytes' handle is never read now: the renderer gets the draft instead
    releaseDocHandoff(result.dataUrl)
    return { ...result, dataUrl: mintDocHandoff(data), recovered: true }
  }

  function remember(file: FileMeta): void {
    files.set(file.fileId, { ...files.get(file.fileId), ...file })
    current = file.fileId
    // G8-12: the comments anchor base follows the open file (open, reload, adopted head, save)
    const meta = files.get(file.fileId)!
    frameDocVersion.noteOpened({ path: pathFor(meta), versionId: meta.versionId ?? null })
  }

  async function toOpenResult(open: OpenPayload): Promise<OpenFileResult> {
    const data = await readSource(open.source)
    // another document: the pending version and the bar of the old one are gone
    if (current !== null && current !== open.file.fileId) remote?.reset()
    sizeGate.noteDocumentOpened(open.file.fileId, open.limits)
    fatal = null
    hideFatal()
    fileSizes.set(open.file.fileId, data.byteLength)
    remember(open.file)
    bindLagDetectorPort(port, grants)
    queueDocumentLoaded(open.file.fileId, data.byteLength)
    return {
      path: pathFor(open.file),
      name: open.file.name,
      dataUrl: mintDocHandoff(data),
      hash: await sha256Hex(data),
    }
  }

  async function openById(fileId: string): Promise<OpenFileResult> {
    const open = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.transfer })
    return toOpenResult(open)
  }

  // ------------------------------------------------------------ fatal state

  /** set when the document could not be opened: saves are refused until a host `open` succeeds */
  let fatal: ProtocolErrorShape | null = null

  function setFatal(err: unknown): void {
    fatal = toProtocolError(err).toShape()
    // not embedded at all vs. a host that did not (or could not) open the document
    showFatal(
      fatal.code === 'not_ready' && window.parent === window ? 'appWebNoHost' : 'appWebFatalBody',
    )
  }

  function fatalSave(): { ok: boolean; path?: string; error?: string } {
    return { ok: false, error: text('appWebFatalTitle') }
  }

  // ------------------------------------------------------------ save bookkeeping

  /** set while the host's `save` request runs the editor's save flow */
  let hostSave: {
    error: ProtocolErrorShape | null
    /** the conflict dialog's answer (overwritten / reloaded / cancelled / failed) */
    answer: SaveResult | null
  } | null = null
  /** set while the host's `saveAs` request waits for the editor's saveDocxAs */
  let hostSaveAs: {
    name?: string
    settle: (r: SaveResult) => void
    /** the editor reached saveDocxAs: stop the "did not start" timer */
    started: () => void
  } | null = null

  function landed(result: Extract<SaveResult, { ok: true }>): FileMeta {
    const file = { ...result.file }
    if (result.versionId && !file.versionId) file.versionId = result.versionId
    remember(file)
    const meta = files.get(file.fileId)!
    frameDocVersion.noteSaved({ path: pathFor(meta), versionId: meta.versionId ?? null })
    sizeGate.noteSaveSucceeded()
    void drafts.saved()
    port.reportSaved({
      file: files.get(file.fileId)!,
      ...(result.versionId ? { versionId: result.versionId } : {}),
      initiatedByFrame: hostSave === null && hostSaveAs === null,
    })
    // the renderer clears its dirty flag once the save call resolves
    setTimeout(session.pushDirty, 0)
    return file
  }

  /** api.save / api.saveAs: a rejection and an ok:false result are both failures */
  async function sendSave(type: string, send: () => Promise<SaveResult>): Promise<SaveResult> {
    try {
      const res = await send()
      if (res?.ok === true && res.file) return res
      if (res?.ok === false) return res
      return failure('malformed', `${type}: unexpected result`)
    } catch (err) {
      return { ok: false, error: saveError(err) }
    }
  }

  // ------------------------------------------------------------ open plumbing

  type OpenHandler = (result: Exclude<OpenDocxResult, null>) => void
  const openListeners = new Set<OpenHandler>()
  let booted = false
  let pendingOpen: Promise<OpenDocxResult> | null = port
    .whenInitialized()
    .then((s) => {
      grants = s.capabilities
      readOnlyProfile = isReadOnlyProfile(s)
      initDocumentId = s.documentId
      return s.open ? toOpenResult(s.open) : openById(s.documentId)
    })
    .then(withDraft)
    .catch((err: unknown) => {
      console.error('[docs-web] initial open failed:', err)
      port.reportError(err, true)
      setFatal(err)
      return null
    })

  function deliver(result: OpenFileResult): void {
    if (booted && openListeners.size > 0) for (const l of openListeners) l(result)
    else pendingOpen = Promise.resolve(result)
  }

  port.handleOpen(async (payload) => {
    const result = await withDraft(await toOpenResult(payload))
    fatal = null
    hideFatal()
    deliver(result)
    return { opened: true, title: result.name }
  })

  /** the answer of a save the frame refuses because the document was revoked / deleted */
  function lockedSave(): SaveResult | null {
    const lock = remote?.locked()
    if (!lock) return null
    return failure(lock === 'revoked' ? 'forbidden' : 'not_found', remote!.lockText())
  }

  port.handleSave(async () => {
    if (fatal) return { ok: false, error: fatal }
    const locked = lockedSave()
    if (locked) return locked
    if (!current) return failure('not_ready', 'no document is open')
    if (isViewOnly(current)) return failure('unsupported', READ_ONLY)
    if (hostSave) return failure('busy', 'a save is already running')
    hostSave = { error: null, answer: null }
    try {
      const ok = await session.runSave()
      if (hostSave.answer) return hostSave.answer
      const file = files.get(current)
      if (ok && file) {
        return { ok: true, file, ...(file.versionId ? { versionId: file.versionId } : {}) }
      }
      return {
        ok: false,
        error: hostSave.error ?? { code: 'internal', message: 'save did not complete' },
      }
    } finally {
      hostSave = null
    }
  })

  port.handleSaveAs(async (payload) => {
    if (fatal) return { ok: false, error: fatal }
    const locked = lockedSave()
    if (locked) return locked
    if (!canSaveAs()) return failure('unsupported', READ_ONLY)
    if (hostSaveAs) return failure('busy', 'a save-as is already running')
    return new Promise<SaveResult>((resolve) => {
      // bounded wait for the editor to reach saveDocxAs (it serializes the document first);
      // the host's name/folder dialog after that has no timeout (TIMEOUTS.dialog)
      const timer = setTimeout(
        () => settle(failure('timeout', 'the editor did not start Save As')),
        TIMEOUTS.editorStart,
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
      if (!session.runMenuCommand('save-as')) settle(failure('not_ready', 'no editor is listening'))
    })
  })

  // ------------------------------------------------------------ conflicts / unknown outcomes

  /**
   * After a save whose outcome is unknown (timeout / network; the request was cancelled but
   * the host may have committed it): when the head moved on and holds exactly the bytes we sent,
   * it is our own write and its etag becomes the base of the next save. Anything else (also a
   * same-size foreign version) keeps the old etag, so a real concurrent edit still surfaces as a
   * conflict prompt (./head-match.ts).
   */
  async function reconcileAfterUnknown(fileId: string, sent: ArrayBuffer): Promise<void> {
    const head = await ownHeadAfterUnknown(port, fileId, files.get(fileId)?.etag, sent)
    if (head) remember(head)
  }

  /**
   * A save that hit `conflict` (frame-initiated or the host's `save`): the shared conflict dialog
   * settles it in the frame. The host's `save` gets its answer from the outcome (hostSave.answer).
   */
  async function resolveConflict(
    fileId: string,
    data: ArrayBuffer,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified' }> {
    const outcome = await runConflictDialog({
      title: text('appWebConflictTitle'),
      body: text('appWebConflictBody'),
      reloadLabel: text('appWebConflictReload'),
      overwriteLabel: text('appWebConflictOverwrite'),
      cancelLabel: text('appCancel'),
      baseRevision: revisionOf(files.get(fileId)),
      readHead: async () => headFromFile(await readHeadFile(port, fileId)),
      overwrite: async () => {
        const res = await overwriteHead(port, fileId, data)
        if (res.ok && res.file) {
          landed({
            ok: true,
            file: res.file,
            ...(res.versionId ? { versionId: res.versionId } : {}),
          })
        }
        return res
      },
      reload: async () => {
        deliver(await openById(fileId))
        return true
      },
      saveCopy: saveCopyVia(port, grants, !isViewOnly(fileId), data, () => files.get(fileId)?.name),
      canEdit: () => !isViewOnly(fileId),
      // "View differences": my bytes against the head's, read now; the head is not adopted
      // (no `remember`): the etag the next save uses stays the one the user is resolving
      viewDiff: async () => {
        try {
          const head = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.transfer })
          if (head?.file?.fileId !== fileId) throw new Error('the head could not be read')
          return await buildDiff(data, await readSource(head.source), head.file.name)
        } catch (err) {
          return diffFailure(err)
        }
      },
      download: downloadVia(port, grants, () => data, {
        size: data.byteLength,
        maxBytes: downloadCap(),
      }),
      sizeBytes: data.byteLength,
      maxBytes: sizeGate.limits().max_bytes,
      ...conflictFrame(),
    })
    const file = files.get(fileId)
    if (hostSave && file) hostSave.answer = conflictSaveResult(outcome, file)
    if (outcome.kind === 'overwritten') return { ok: true }
    // the document is being replaced by the latest version: no error banner
    if (outcome.kind === 'reloaded') return { ok: false, reason: 'external-modified' }
    if (outcome.kind === 'failed') {
      // a 401 / 403 / 410 the Overwrite got: the bar of the document's new state stays behind, and
      // it is the only surface: no failure toast of the editor on top of it
      const shown = remote?.saveFailed({
        code: outcome.code,
        ...(outcome.apiCode ? { details: { apiCode: outcome.apiCode } } : {}),
      })
      if (shown) return { ok: false, reason: 'external-modified' }
      return {
        ok: false,
        error: saveFailureText({ code: outcome.code, message: '' }, () =>
          text('appWebSaveOffline'),
        ),
      }
    }
    return { ok: false, error: text('appWebConflictNotSaved') }
  }

  /** before another document replaces this one: unsaved edits need an explicit discard */
  async function mayReplace(): Promise<boolean> {
    if (!session.isDirty()) return true
    const choice = await ask({
      title: 'appWebDiscardTitle',
      body: 'appWebDiscardBody',
      choices: [
        { id: 'cancel', label: 'appCancel', primary: true },
        { id: 'discard', label: 'appWebDiscard', danger: true },
      ],
      cancelId: 'cancel',
      marker: 'discard',
    })
    return choice === 'discard'
  }

  type RenameHandler = (paths: { oldPath: string; newPath: string }) => void
  const renameListeners = new Set<RenameHandler>()
  port.onFileRenamed((file) => {
    const prev = files.get(file.fileId)
    if (!prev || prev.name === file.name) return
    const oldPath = pathFor(prev)
    files.set(file.fileId, { ...prev, ...file })
    for (const l of renameListeners) l({ oldPath, newPath: pathFor(file) })
  })

  // ------------------------------------------------------------ export / print

  /**
   * The in-frame print dialog through the BROWSER print path (browser.ts printFrame: print
   * sheet, print-color-adjust, light theme pin, settles on `afterprint`).
   */
  async function printViaBrowser(): Promise<PdfExportResult> {
    const r = await (opts.print ?? printFrame)()
    // no file was produced: `printDialog` lets the renderer say so instead of "exported"
    return r.ok
      ? { ok: true, printDialog: true }
      : { ok: false, ...(r.error ? { error: r.error } : {}) }
  }

  /** the renderer's live-document serializer (App.tsx registers it via provideDocBytes) */
  let docBytesProvider: (() => Promise<ArrayBuffer | null>) | null = null

  async function liveDocBytes(): Promise<ArrayBuffer | null> {
    try {
      return (await docBytesProvider?.()) ?? null
    } catch (err) {
      console.warn('[docs-web] serializing the live document failed:', err)
      return null
    }
  }

  const sizeGate = createSaveSizeGate({
    port,
    getLiveBytes: liveDocBytes,
    persistDraft: () => drafts.flush(),
    frame: conflictFrame(),
  })

  /**
   * Server-rendered PDF. A clean document exports its stored version by
   * `fileId`; unsaved edits (or a never-saved document) also send the live
   * docx bytes as `data` (hosts without byte support ignore them). Nothing to
   * export or any failure -> the in-frame print dialog.
   */
  async function exportCurrentPdf(
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    scale?: number,
  ): Promise<PdfExportResult> {
    if (!canExportPdf()) return { ok: false, error: 'unsupported' }
    const fileId = current
    const data = !fileId || session.isDirty() ? await liveDocBytes() : null
    if (!fileId && !data) return printViaBrowser()
    const name = withExt(defaultName || (fileId && files.get(fileId)?.name) || 'document', '.pdf')
    try {
      const out = await port.request(
        'api.export',
        {
          format: 'pdf',
          ...(fileId ? { fileId } : {}),
          ...(data ? { data } : {}),
          name,
          ...(pageWidthTwips > 0 ? { pageWidthTwips } : {}),
          ...(pageHeightTwips > 0 ? { pageHeightTwips } : {}),
          scale: scale ?? 1,
        },
        { timeoutMs: TIMEOUTS.transfer, ...(data ? { transfer: [data] } : {}) },
      )
      downloadBlob(
        out.name || name,
        new Blob([out.data], { type: out.mimeType || 'application/pdf' }),
      )
      return { ok: true, path: out.name || name }
    } catch (err) {
      if (errorCode(err) === 'cancelled') return { ok: false }
      console.warn('[docs-web] api.export failed, falling back to print:', err)
      return printViaBrowser()
    }
  }

  port.handlePrint(async (payload) => {
    if (payload?.mode === 'pdf') {
      const name = (current && files.get(current)?.name) || 'document'
      const r = await exportCurrentPdf(name, 0, 0)
      return { printed: r.ok }
    }
    // answered after the print settles (afterprint), so the host knows the job is over
    const r = await (opts.print ?? printFrame)()
    return { printed: r.ok }
  })

  // ------------------------------------------------------------ new version on UniWork (G5-03w, S6)

  remote = createRemoteVersion({
    port,
    current: () =>
      current === null ? null : { fileId: current, revision: revisionOf(files.get(current)) },
    isDirty: () => session.isDirty(),
    canEdit: () => !isViewOnly(current),
    // a clean reload replaces the open document in place, like a host `open` (no draft prompt)
    apply: async (reply) => {
      deliver(await toOpenResult(reply))
    },
    download: () =>
      downloadVia(port, grants, async () => {
        const bytes = await liveDocBytes()
        if (!bytes) throw new Error('the open document could not be serialized')
        return bytes
      }),
    frame: conflictFrame(),
  })

  // ------------------------------------------------------------ DesktopApi part

  const desktopPart = {
    ...session.desktop,

    async consumePendingOpenDocx(): Promise<OpenDocxResult> {
      booted = true
      const pending = pendingOpen
      pendingOpen = null
      return pending ? await pending : null
    },

    noteDocumentMounted(): void {
      documentMounted()
    },

    onOpenDocx(handler: OpenHandler): () => void {
      openListeners.add(handler)
      return () => {
        openListeners.delete(handler)
      }
    },

    provideDocBytes(provider: () => Promise<ArrayBuffer | null>): () => void {
      docBytesProvider = provider
      return () => {
        if (docBytesProvider === provider) docBytesProvider = null
      }
    },

    onRenamedDocx(handler: RenameHandler): () => void {
      renameListeners.add(handler)
      return () => {
        renameListeners.delete(handler)
      }
    },

    async confirmDocumentReplace(): Promise<boolean> {
      if (fatal !== null) return false
      return mayReplace()
    },

    async openDocx(): Promise<OpenDocxResult> {
      try {
        const res = await port.request(
          'file.pick',
          { purpose: 'open', accept: ['docx'] },
          { timeoutMs: TIMEOUTS.dialog },
        )
        if (!res?.file || !(await mayReplace())) return null
        return await toOpenResult(res.file)
      } catch (err) {
        if (errorCode(err) !== 'cancelled') console.error('[docs-web] file.pick failed:', err)
        return null
      }
    },

    async openDocxPath(path: string): Promise<OpenDocxResult> {
      const fileId = idFromPath(path)
      if (!fileId || !(await mayReplace())) return null
      try {
        return await openById(fileId)
      } catch (err) {
        console.error('[docs-web] openDocxPath failed:', err)
        return null
      }
    },

    async saveDocx(
      path: string,
      data: ArrayBuffer,
      auto?: boolean,
    ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified' }> {
      if (fatal) {
        if (hostSave) hostSave.error = fatal
        return fatalSave()
      }
      const lock = lockedSave()
      if (lock && !lock.ok) {
        if (hostSave) hostSave.error = lock.error
        return { ok: false, error: lock.error.message }
      }
      const fileId = idFromPath(path)
      if (!fileId) return { ok: false, error: `not a UniWork document: ${basename(String(path))}` }
      // the editor is read-only here (uniworkState); this refuses a save that still gets through
      if (isViewOnly(fileId)) return { ok: false, error: READ_ONLY }
      const gate = await sizeGate.checkBeforeSave(data)
      if (!gate.allowed) {
        if (hostSave) hostSave.error = gate.error
        return { ok: false, reason: 'external-modified' }
      }
      const etag = files.get(fileId)?.etag
      const payload = {
        fileId,
        data: copyBuffer(data),
        ...(etag ? { etag } : {}),
        auto: auto === true,
      }
      const res = await sendSave('api.save', () =>
        port.request('api.save', payload, {
          timeoutMs: TIMEOUTS.transfer,
          transfer: [payload.data],
        }),
      )
      if (res.ok) {
        landed(res)
        return { ok: true }
      }
      if (hostSave) hostSave.error = res.error
      const code = res.error.code
      if (code === 'too_large') {
        sizeGate.handleServerTooLarge(res.error, data)
        return { ok: false, reason: 'external-modified' }
      }
      const shown = remote?.saveFailed(res.error) === true
      if (code === 'conflict') {
        // the host's own `save` waits for the dialog's answer instead of an error event
        if (!hostSave) port.reportError(res.error, false)
        // an autosave never prompts: it stays dirty and the next manual save asks
        if (auto === true) return { ok: false, reason: 'external-modified' }
        return resolveConflict(fileId, data)
      }
      if (code === 'timeout' || code === 'network') {
        await reconcileAfterUnknown(fileId, data)
      }
      // the new-version bar says it (401 / 403 / 410): the editor shows neither a toast nor a status
      // line of its own; the reason is the one that means "stay dirty, nothing more to say here"
      if (shown) return { ok: false, reason: 'external-modified' }
      return {
        ok: false,
        // a raw browser error ("Failed to fetch") or status line is English whatever the UI language
        error: saveFailureText(res.error, () => text('appWebSaveOffline')),
      }
    },

    async saveDocxAs(defaultName: string, data: ArrayBuffer, sourcePath?: string | null) {
      const pending = hostSaveAs
      pending?.started()
      if (fatal) {
        pending?.settle({ ok: false, error: fatal })
        return fatalSave()
      }
      const lock = lockedSave()
      if (lock && !lock.ok) {
        pending?.settle(lock)
        return { ok: false, error: lock.error.message }
      }
      // "save a copy" is its own grant (`saveAs`) regardless of whether `save` is granted
      if (!canSaveAs()) {
        const errText = isViewOnly(idFromPath(sourcePath)) ? READ_ONLY : 'unsupported'
        pending?.settle(failure('unsupported', errText))
        return { ok: false, error: errText }
      }
      const gate = await sizeGate.checkBeforeSave(data)
      if (!gate.allowed) {
        pending?.settle({ ok: false, error: gate.error })
        return { ok: false }
      }
      const sourceFileId = idFromPath(sourcePath)
      const payload = {
        name: withExt(pending?.name || defaultName || 'Untitled', '.docx'),
        data: copyBuffer(data),
        ...(sourceFileId ? { sourceFileId } : {}),
      }
      const res = await sendSave('api.saveAs', () =>
        port.request('api.saveAs', payload, {
          timeoutMs: TIMEOUTS.dialog,
          transfer: [payload.data],
        }),
      )
      if (res.ok) {
        const file = landed(res)
        pending?.settle(res)
        return { ok: true, path: pathFor(file) }
      }
      pending?.settle(res)
      // cancelled dialog: {ok:false} without error, like the desktop
      if (res.error.code === 'cancelled') return { ok: false }
      if (res.error.code === 'too_large') {
        sizeGate.handleServerTooLarge(res.error, data)
        return { ok: false }
      }
      // the bar says it: a result without an error shows no toast (like a cancelled dialog)
      if (remote?.saveFailed(res.error)) return { ok: false }
      return { ok: false, error: saveFailureText(res.error, () => text('appWebSaveOffline')) }
    },

    async saveDocxNew(defaultName: string, data: ArrayBuffer) {
      // after a failed open the blank fallback document must not become a new workspace file
      if (fatal) {
        if (hostSave) hostSave.error = fatal
        return fatalSave()
      }
      const lock = lockedSave()
      if (lock && !lock.ok) return { ok: false, error: lock.error.message }
      if (isViewOnly() && !canSaveAs()) {
        if (hostSave) hostSave.error = { code: 'unsupported', message: READ_ONLY }
        return { ok: false, error: READ_ONLY }
      }
      const gate = await sizeGate.checkBeforeSave(data)
      if (!gate.allowed) {
        if (hostSave) hostSave.error = gate.error
        return { ok: false }
      }
      const payload = {
        name: withExt(defaultName || 'Untitled', '.docx'),
        data: copyBuffer(data),
        silent: true,
      }
      const res = await sendSave('api.saveAs', () =>
        port.request('api.saveAs', payload, {
          timeoutMs: TIMEOUTS.transfer,
          transfer: [payload.data],
        }),
      )
      if (!res.ok) {
        if (hostSave) hostSave.error = res.error
        if (res.error.code === 'too_large') {
          sizeGate.handleServerTooLarge(res.error, data)
          return { ok: false }
        }
        if (remote?.saveFailed(res.error)) return { ok: false }
        return { ok: false, error: saveFailureText(res.error, () => text('appWebSaveOffline')) }
      }
      return { ok: true, path: pathFor(landed(res)) }
    },

    async getRecentFiles(): Promise<string[]> {
      try {
        const res = await port.request('api.recents', { limit: 20 }, { timeoutMs: TIMEOUTS.short })
        return Array.isArray(res?.files)
          ? res.files
              .filter((f) => typeof f?.fileId === 'string' && typeof f.name === 'string')
              .map(pathFor)
          : []
      } catch (err) {
        console.warn('[docs-web] api.recents failed:', err)
        return []
      }
    },

    async exportHtml(defaultName: string, html: string, _outPath?: string) {
      if (!canExportHtml()) return { ok: false, error: 'unsupported' }
      if (typeof html !== 'string' || !html) return { ok: false, error: 'empty document' }
      const name = withExt(defaultName, '.html')
      downloadBlob(name, new Blob([html], { type: 'text/html;charset=utf-8' }))
      return { ok: true, path: name }
    },

    exportPdf(
      defaultName: string,
      pageWidthTwips: number,
      pageHeightTwips: number,
      _outPath?: string,
      scale?: number,
    ) {
      return exportCurrentPdf(defaultName, pageWidthTwips, pageHeightTwips, scale)
    },

    async printPdfBuffer(_pageWidthTwips: number, _pageHeightTwips: number, _scale?: number) {
      return { ok: true, base64: WEB_PRINT_PART }
    },

    async saveMergedPdf(defaultName: string, base64Parts: string[], _outPath?: string) {
      if (!canExportPdf()) return { ok: false, error: 'unsupported' }
      if (base64Parts.every((p) => p === WEB_PRINT_PART)) return exportCurrentPdf(defaultName, 0, 0)
      return { ok: false, error: 'merging real PDF parts is not supported on web' }
    },

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

    async convertAltChunkHtml(html: string): Promise<Uint8Array | null> {
      if (typeof html !== 'string' || !html) return null
      try {
        const res = await port.request(
          'convert.altChunkHtml',
          { html },
          { timeoutMs: TIMEOUTS.transfer },
        )
        return res?.data ? new Uint8Array(copyBuffer(res.data)) : null
      } catch {
        return null
      }
    },

    // the frame is the UniWork document: no desktop working-copy state. View-only comes from the host
    // grant (no `save`) or the file (`writable: false`); the renderer then turns the editor, the ribbon
    // and the save entries read-only (the same seam the desktop uses for a view-only working copy).
    async uniworkState(path: string): Promise<{ bound: boolean; readOnly: boolean }> {
      try {
        const session = await port.whenInitialized()
        grants = session.capabilities
      } catch {
        return { bound: false, readOnly: fatal !== null }
      }
      return { bound: false, readOnly: fatal !== null || isViewOnly(idFromPath(path)) }
    },

    reportOpenRefused(info) {
      const fileId = idFromPath(info.path) ?? current ?? initDocumentId
      const bytes =
        typeof info.bytes === 'number' && info.bytes > 0
          ? info.bytes
          : fileId
            ? fileSizes.get(fileId)
            : undefined
      // at most once per documentId per session (contract §3.1a)
      if (fileId && !refusedIds.has(fileId)) {
        refusedIds.add(fileId)
        port.reportOpenRefused?.({
          reason: info.reason,
          ...(bytes !== undefined ? { bytes } : {}),
          ...(info.measure ? { measure: info.measure } : {}),
        })
      }
      const message = info.message ?? 'Document is too large to open.'
      // the refused state: no save path of this documentId runs until a host `open` succeeds. No
      // `error` event: the frame stays alive on its own refusal notice and `open_refused` lets the
      // host offer another way to open the file
      fatal = { code: 'too_large', message }
      if (current === fileId) current = null
      port.setDirty(false)
    },
  } satisfies Partial<DesktopApi>

  // install.ts merges this into window.desktop and assigns `.projectApi` to window.projectApi
  return Object.assign(desktopPart, { projectApi })
}

export type WebApi = ReturnType<typeof createWebApi>
