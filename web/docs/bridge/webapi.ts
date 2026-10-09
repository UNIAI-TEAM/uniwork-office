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
 * Save conflicts (the host answers `conflict`: someone saved a newer version). A host `save`
 * request gets it in its SaveResult and owns the UI. Otherwise the host gets an `error` event
 * {code:'conflict', fatal:false} and, for a manual save, the frame asks like the desktop's
 * "modified by another program" box (./notice.ts): Overwrite (re-read the head etag with
 * api.open, save again), Reload latest (api.open replaces the document) or Cancel (stays dirty,
 * "Save failed" with the reason; the next save asks again). An autosave never prompts.
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
import type { DesktopApi, OpenDocxResult, OpenFileResult } from '../../../apps/docs/src/shared/ipc'
import {
  toProtocolError,
  type FileMeta,
  type FileSource,
  type OpenPayload,
  type ProtocolErrorShape,
  type SaveResult,
} from '../protocol/types'
import { TIMEOUTS, errorCode, type FramePort } from './frame-port'
import { downloadBlob, printFrame } from './browser'
import { ask, hideFatal, showFatal, text } from './notice'
import { createSession, type SessionOptions } from './session'
import type { DraftHost, DraftRecovery } from './draft-recovery'
import { bridgeDraftRecovery } from '../../modules/shared/recovery-prompt'
import { projectApi } from './project-memory'

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

function decodeDataUrl(url: string): { base64: string; mime: string } | null {
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

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function failure(code: ProtocolErrorShape['code'], message: string): SaveResult {
  return { ok: false, error: { code, message } }
}

/** a rejected request or an ok:false SaveResult, as one shape */
function saveError(err: unknown): ProtocolErrorShape {
  return { code: errorCode(err), message: describe(err) }
}

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
  /** the document this frame shows (save / export target) */
  let current: string | null = null
  const session = createSession(port, opts.session)

  // ------------------------------------------------------------ draft recovery (C18)

  /** the document `init` names: the only one the host's draft scope ("<user>:<document>") covers */
  let initDocumentId: string | null = null
  let restoredDraft: ArrayBuffer | null = null
  const drafts = (opts.drafts ?? ((host) => bridgeDraftRecovery(port, 'docs', host)))({
    file: () => {
      const file = current !== null && current === initDocumentId ? files.get(current) : undefined
      return file ? { etag: file.etag, name: file.name } : null
    },
    isDirty: () => session.isDirty(),
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
    return data ? { ...result, data, recovered: true } : result
  }

  function remember(file: FileMeta): void {
    files.set(file.fileId, { ...files.get(file.fileId), ...file })
    current = file.fileId
  }

  async function toOpenResult(open: OpenPayload): Promise<OpenFileResult> {
    const data = await readSource(open.source)
    remember(open.file)
    return { path: pathFor(open.file), name: open.file.name, data, hash: await sha256Hex(data) }
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
  let hostSave: { error: ProtocolErrorShape | null } | null = null
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

  port.handleSave(async () => {
    if (fatal) return { ok: false, error: fatal }
    if (!current) return failure('not_ready', 'no document is open')
    if (hostSave) return failure('busy', 'a save is already running')
    hostSave = { error: null }
    try {
      const ok = await session.runSave()
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

  /** api.open for the metadata only (the head etag); the source is not downloaded */
  async function headMeta(fileId: string): Promise<FileMeta | null> {
    try {
      const open = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.short })
      return open?.file?.fileId === fileId ? open.file : null
    } catch (err) {
      console.warn('[docs-web] reading the head version failed:', err)
      return null
    }
  }

  /**
   * After a save whose outcome is unknown (timeout / network; the request was cancelled but
   * the host may have committed it): when the head moved on and has exactly the size we sent,
   * it is taken to be our own write and its etag becomes the base of the next save. Anything
   * else keeps the old etag, so a real concurrent edit still surfaces as a conflict prompt.
   */
  async function reconcileAfterUnknown(fileId: string, sentBytes: number): Promise<void> {
    const before = files.get(fileId)
    const head = await headMeta(fileId)
    if (!head || !before?.etag || head.etag === before.etag) return
    if (head.sizeBytes === sentBytes) remember(head)
  }

  /** the user chose for a frame-initiated save that hit `conflict` */
  async function resolveConflict(
    path: string,
    fileId: string,
    data: ArrayBuffer,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified' }> {
    const choice = await ask({
      title: 'appWebConflictTitle',
      body: 'appWebConflictBody',
      choices: [
        { id: 'cancel', label: 'appCancel' },
        { id: 'reload', label: 'appWebConflictReload' },
        { id: 'overwrite', label: 'appWebConflictOverwrite', primary: true },
      ],
      cancelId: 'cancel',
      marker: 'conflict',
    })
    if (choice === 'overwrite') {
      const head = await headMeta(fileId)
      if (!head) return { ok: false, error: text('appWebConflictNotSaved') }
      remember(head)
      return desktopPart.saveDocx(path, data, false)
    }
    if (choice === 'reload') {
      try {
        deliver(await openById(fileId))
        // the document is being replaced by the latest version: no error banner
        return { ok: false, reason: 'external-modified' }
      } catch (err) {
        console.error('[docs-web] reloading the latest version failed:', err)
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
        { id: 'discard', label: 'appWebDiscard' },
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
  async function printViaBrowser(
    defaultName: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    const r = await (opts.print ?? printFrame)()
    return r.ok
      ? { ok: true, path: `${withExt(defaultName, '.pdf')} (browser print dialog)` }
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
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    const fileId = current
    const data = !fileId || session.isDirty() ? await liveDocBytes() : null
    if (!fileId && !data) return printViaBrowser(defaultName)
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
      return printViaBrowser(defaultName)
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

  // ------------------------------------------------------------ DesktopApi part

  const desktopPart = {
    ...session.desktop,

    async consumePendingOpenDocx(): Promise<OpenDocxResult> {
      booted = true
      const pending = pendingOpen
      pendingOpen = null
      return pending ? await pending : null
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
      const fileId = idFromPath(path)
      if (!fileId) return { ok: false, error: `not a UniWork document: ${basename(String(path))}` }
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
      if (code === 'conflict') {
        // a host `save` request gets the conflict in its result and owns the UI
        if (hostSave) return { ok: false, reason: 'external-modified', error: res.error.message }
        port.reportError(res.error, false)
        // an autosave never prompts: it stays dirty and the next manual save asks
        if (auto === true) return { ok: false, reason: 'external-modified' }
        return resolveConflict(path, fileId, data)
      }
      if (code === 'timeout' || code === 'network') {
        await reconcileAfterUnknown(fileId, data.byteLength)
      }
      return {
        ok: false,
        error: res.error.code === 'timeout' ? 'save timed out' : res.error.message,
      }
    },

    async saveDocxAs(defaultName: string, data: ArrayBuffer, sourcePath?: string | null) {
      const pending = hostSaveAs
      pending?.started()
      if (fatal) {
        pending?.settle({ ok: false, error: fatal })
        return fatalSave()
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
      return { ok: false, error: res.error.message }
    },

    async saveDocxNew(defaultName: string, data: ArrayBuffer) {
      // after a failed open the blank fallback document must not become a new workspace file
      if (fatal) {
        if (hostSave) hostSave.error = fatal
        return fatalSave()
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
        return { ok: false, error: res.error.message }
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
  } satisfies Partial<DesktopApi>

  // install.ts merges this into window.desktop and assigns `.projectApi` to window.projectApi
  return Object.assign(desktopPart, { projectApi })
}

export type WebApi = ReturnType<typeof createWebApi>
