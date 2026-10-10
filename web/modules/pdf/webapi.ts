/**
 * window.pdfApi of the PDF web frame (GO-B4 / UNI-1014, P-1..P-3, P-5) over the frame protocol.
 * Desktop source of truth: apps/pdf/src/main/pdf-main.ts (`pdf:*` handlers) + apps/pdf/src/preload.
 *
 * The desktop renderer works on a file path: it reads the bytes after every save / page operation
 * (`readFile(path)`) and the main process rewrites the file. The frame has no disk, so it keeps an
 * in-frame WORKING COPY: the bytes of the version this frame last opened or saved. The renderer's
 * `readFile(path)` reads it, every save / in-place page operation runs the save core
 * (apps/pdf/src/main, bytes in / bytes out, ./core.ts) on it and uploads the result.
 *
 * | pdfApi method                     | web                                                                      |
 * |-----------------------------------|--------------------------------------------------------------------------|
 * | consumePending                    | init.open, else api.open {fileId: init.documentId} -> working copy path  |
 * | readFile(path)                    | a copy of the working copy (pdf.js transfers its buffer)                 |
 * | save(request)                     | core applyAndVerifySaveRequest -> api.save {fileId, data, etag}          |
 * | save({targetPath}) (Save As)      | the same bytes -> api.saveAs {name, data, sourceFileId}; original kept   |
 * | insertBlankPage / setPageSize /   | core *Bytes on the working copy -> api.save (the desktop rewrites the    |
 * |   cropPages                       |   file in place too)                                                     |
 * | insertPdf / replacePages          | file.pick {purpose:'insert', accept:['pdf']} + core -> api.save          |
 * | extractPages / mergePages /       | core -> browser download (the desktop writes a new file and opens it)    |
 * |   splitPages                      |                                                                          |
 * | mergePdf                          | repeated single file.pick ("add another / merge now") -> download        |
 * | splitPdf / exportImages           | one file: download; several: one .zip download                           |
 * | listStaticFormFills, validate-    | core on the working copy, in the frame (pdfium under 'wasm-unsafe-eval') |
 * |   TextEdits, listEditFonts,       |                                                                          |
 * |   canDrawText, listPageImages,    |                                                                          |
 * |   pageImagePng, pagePreviewPng    |                                                                          |
 * | list/add/removeSavedSignature     | encrypted per-user store (./signatures.ts)                              |
 * | getUsername                       | init.user.displayName ('' when absent)                                   |
 * | setDirty                          | frame event `dirty`                                                      |
 * | onCloseSaveRequest / send...      | host `save` request runs the renderer's save flow                        |
 * | onSaveAsRequest / send...         | host `saveAs` request runs the renderer's Save As flow                   |
 * | onPrintRequest                    | host `print` request opens the renderer's print dialog                  |
 * | onReloadRequest (web only)        | host `open`, or "Reload latest" in a save conflict                       |
 * | provideSaveRequest (web only)     | draft recovery (C18): the renderer's pending edits, applied to the       |
 * |                                   |   working copy every 30 s while dirty -> encrypted IndexedDB copy        |
 * | consumeRecovered (web only)       | the open bytes are a restored draft: the renderer starts dirty           |
 * | AI, OCR, convert, auto-rename,    | typed stubs; their entries are hidden by capabilities (./install.ts)     |
 * |   createDocument, image search    |                                                                          |
 *
 * Save conflicts (api.save answers `conflict`): a host `save` request gets the conflict in its
 * SaveResult and owns the UI. Otherwise the frame asks like Docs (./notice.ts): Overwrite (re-read
 * the head etag, save again), Reload latest (the renderer reopens the latest version, pending
 * edits are dropped) or Cancel (stays dirty, "Save failed"). Nothing is ever saved without an
 * explicit user action: no `auto` save exists on the web (CONTRACT C10).
 *
 * Draft recovery (C18, web/docs/bridge/draft-recovery.ts): the draft is what a save would write
 * (working copy + the renderer's pending edits). It is offered before the renderer loads the
 * document; Restore makes the draft bytes the working copy (the etag stays the head's, so
 * If-Match still catches a newer version) and keeps the frame dirty until a save lands.
 */
import type {
  PdfApi,
  SavePdfRequest,
  SavePdfResult,
  TextEditFailure,
  TextInsertFailure,
  ImageEditFailure,
} from '../../../apps/pdf/src/shared/ipc'
import { DEFAULT_AI_PANEL_PREFS } from '@genoffice/ui'
import {
  toProtocolError,
  type FileMeta,
  type FileSource,
  type OpenPayload,
  type ProtocolErrorCode,
  type ProtocolErrorShape,
  type SaveResult,
} from '../../docs/protocol/types'
import aiStub from '../../docs/bridge/ai'
import browser, { downloadBlob } from '../../docs/bridge/browser'
import { capEnabled } from '../../docs/bridge/capability-object'
import { TIMEOUTS, errorCode } from '../../docs/bridge/frame-port'
import type { ModuleBridgePort } from '../../docs/bridge/module-bridge'
import type { DraftHost, DraftRecovery } from '../../docs/bridge/draft-recovery'
import { bridgeDraftRecovery, bridgeRecoveryGrant } from '../shared/recovery-prompt'
import type { PdfCore } from './core'
import { ask, hideFatal, showFatal, text } from './notice'
import { createSignatureStore } from './signatures'

// ---------------------------------------------------------------- paths

const PATH_PREFIX = 'uniwork://files/'
const SAVE_AS_PREFIX = 'uniwork://save-as/'

/** the renderer treats a path as opaque and shows `path.split(/[\\/]/).pop()` */
export function pathFor(file: { fileId: string; name: string }): string {
  return `${PATH_PREFIX}${file.fileId}/${file.name}`
}

/** Save As target handed to the renderer; its last segment is the suggested name */
export function saveAsTarget(name: string): string {
  return `${SAVE_AS_PREFIX}${encodeURIComponent(name)}`
}

export function nameFromSaveAsTarget(target: string): string {
  const raw = target.startsWith(SAVE_AS_PREFIX) ? target.slice(SAVE_AS_PREFIX.length) : target
  try {
    return decodeURIComponent(raw.split(/[\\/]/).pop() ?? raw)
  } catch {
    return raw
  }
}

/** "Report" / "Report.pdf" -> "Report.pdf" */
export function withPdf(name: string): string {
  const base = name.trim() || 'document'
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`
}

// ---------------------------------------------------------------- bytes

/** detached copy: neither side may keep a view on a buffer the other transfers */
function copyBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const out = new ArrayBuffer(src.byteLength)
  new Uint8Array(out).set(src)
  return out
}

async function readSource(source: FileSource): Promise<Uint8Array> {
  if (source.kind === 'bytes') return new Uint8Array(copyBuffer(source.data))
  const res = await fetch(source.url, { credentials: 'omit', headers: source.headers })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function failure(code: ProtocolErrorCode, message: string): SaveResult {
  return { ok: false, error: { code, message } }
}

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })
const NOT_GRANTED = 'pdf: path not granted to this view'
const NOT_AVAILABLE = 'Not available in the web build'

type Skips = {
  skippedTextEdits?: TextEditFailure[]
  skippedTextInserts?: TextInsertFailure[]
  skippedImageEdits?: ImageEditFailure[]
}

// ---------------------------------------------------------------- deps

export interface PdfWebDeps {
  /** the save core, with the web seams installed (./core-env-web.ts + ./core.ts) */
  core(): Promise<PdfCore>
  /** fetch the bundled fonts before a core call that may need them */
  ensureFonts(): Promise<void>
  /** the shared capability object (`edit`, `insertPages`, ...); read at call time */
  capabilities: Record<string, unknown>
  signatures?: ReturnType<typeof createSignatureStore>
  /** browser download sink (default: browser.ts downloadBlob) */
  download?(name: string, data: Blob): void
  /** several files -> one zip (default: JSZip, loaded on demand) */
  zip?(files: Array<{ name: string; data: Uint8Array }>): Promise<Blob>
  /** how long a host `save` may wait for the renderer's save flow (ms) */
  saveTimeoutMs?: number
  /** draft recovery (C18; default: IndexedDB + the shared prompt); injectable for tests */
  drafts?(host: DraftHost): DraftRecovery
}

async function jszip(files: Array<{ name: string; data: Uint8Array }>): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const f of files) zip.file(f.name, f.data)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })
}

function safeBase(name: string): string {
  return String(name || 'document').replace(/[/\\:*?"<>|]/g, '_')
}

/** every pdfApi member the renderer may call; a new preload method is a type error here */
export type PdfWebApi = { [K in Exclude<keyof PdfApi, 'capabilities'>]-?: NonNullable<PdfApi[K]> }

// ---------------------------------------------------------------- factory

export function createPdfWebApi(port: ModuleBridgePort, deps: PdfWebDeps) {
  const download = deps.download ?? downloadBlob
  const zip = deps.zip ?? jszip
  const signatures =
    deps.signatures ??
    createSignatureStore({
      recovery: bridgeRecoveryGrant(port),
      ready: () => port.whenInitialized(),
    })
  const can = (key: string) => capEnabled(deps.capabilities, key)

  /** the working copy: the version this frame last opened or saved */
  let doc: { file: FileMeta; bytes: Uint8Array } | null = null
  let fatal: ProtocolErrorShape | null = null
  let author = ''
  let rendererDirty = false
  /** the working copy is a restored draft not saved yet (dirty with no renderer edits) */
  let restored = false
  /** consumeRecovered's one-shot flag for the renderer's next open */
  let recoveredFlag = false
  /** the document `init` names: the only one the host's draft scope ("<user>:<document>") covers */
  let initDocumentId: string | null = null
  let saveRequestProvider: (() => SavePdfRequest | null) | null = null

  const currentPath = (): string | null => (doc ? pathFor(doc.file) : null)
  const owns = (path: unknown): boolean => typeof path === 'string' && path === currentPath()

  function adopt(file: FileMeta, bytes: Uint8Array): string {
    doc = { file: { ...file }, bytes }
    port.setTitle(file.name)
    return pathFor(file)
  }

  const dirtyNow = (): boolean => rendererDirty || restored

  /** the save core over `base`: the bytes `request` would write (throws on a core failure) */
  async function applyRequest(
    base: Uint8Array,
    request: SavePdfRequest,
  ): Promise<{ bytes: Uint8Array; skips: Skips }> {
    const fonts = (request.textEdits?.length ?? 0) > 0 || (request.textInserts?.length ?? 0) > 0
    const applied = await (await core(fonts)).applyAndVerifySaveRequest(base, request)
    const { bytes, skippedTextEdits, skippedTextInserts, skippedImageEdits } = applied
    return {
      bytes,
      skips: {
        ...(skippedTextEdits.length > 0 ? { skippedTextEdits } : {}),
        ...(skippedTextInserts.length > 0 ? { skippedTextInserts } : {}),
        ...(skippedImageEdits.length > 0 ? { skippedImageEdits } : {}),
      },
    }
  }

  // ------------------------------------------------------------ draft recovery (C18)

  const drafts = (deps.drafts ?? ((host) => bridgeDraftRecovery(port, 'pdf', host)))({
    file: () =>
      doc && doc.file.fileId === initDocumentId
        ? { etag: doc.file.etag, name: doc.file.name }
        : null,
    isDirty: dirtyNow,
    async bytes() {
      if (!doc) return null
      // nothing pending in the renderer: the working copy itself (a restored draft) is the draft
      if (!rendererDirty) return restored ? doc.bytes.slice() : null
      const request = saveRequestProvider?.() ?? null
      if (!request || !owns(request.path)) return restored ? doc.bytes.slice() : null
      return (await applyRequest(doc.bytes.slice(), request)).bytes
    },
    restore(bytes) {
      if (!doc) return
      doc = { ...doc, bytes: new Uint8Array(copyBuffer(bytes)) }
      restored = true
      recoveredFlag = true
      port.setDirty(true)
    },
  })

  /** offer the open document's draft before the renderer loads it */
  async function withDraft(path: string): Promise<string> {
    await drafts.opened()
    return path
  }

  async function openPayload(open: OpenPayload): Promise<string> {
    let bytes = await readSource(open.source)
    // a new, still empty Documents file: start from the desktop's blank A4 page ("New PDF"),
    // which becomes the file's first version on the first save
    if (bytes.byteLength === 0) bytes = new Uint8Array(await (await deps.core()).blankPdfBuffer())
    // a newly opened version replaces any restored draft
    restored = false
    recoveredFlag = false
    return adopt(open.file, bytes)
  }

  function setFatal(err: unknown): void {
    fatal = toProtocolError(err).toShape()
    showFatal(fatal.code === 'not_ready' && window.parent === window ? 'webNoHost' : 'webFatalBody')
  }

  // ------------------------------------------------------------ renderer hooks

  const reloadListeners = new Set<(path: string) => void>()
  const closeSaveHandlers = new Set<() => void>()
  let closeSaveWaiters: Array<(ok: boolean) => void> = []
  const saveAsHandlers = new Set<(target: string) => void>()
  const printHandlers = new Set<() => void>()

  function emitReload(path: string): void {
    // after the current call stack: the renderer first finishes the save that failed
    setTimeout(() => {
      for (const l of reloadListeners) l(path)
    }, 0)
  }

  /** the renderer's full save flow (close-guard "Save"); false when no viewer listens */
  function runRendererSave(): Promise<boolean> {
    if (closeSaveHandlers.size === 0) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(t)
        closeSaveWaiters = closeSaveWaiters.filter((w) => w !== finish)
        resolve(ok)
      }
      const t = setTimeout(() => finish(false), deps.saveTimeoutMs ?? 180_000)
      closeSaveWaiters.push(finish)
      for (const h of closeSaveHandlers) h()
    })
  }

  // ------------------------------------------------------------ boot open

  let pendingOpen: Promise<string | null> | null = port
    .whenInitialized()
    .then(async (s) => {
      author = s.user?.displayName ?? ''
      initDocumentId = s.documentId
      const open =
        s.open ??
        (await port.request('api.open', { fileId: s.documentId }, { timeoutMs: TIMEOUTS.transfer }))
      return withDraft(await openPayload(open))
    })
    .catch((err: unknown) => {
      console.error('[pdf-web] initial open failed:', err)
      port.reportError(err, true)
      setFatal(err)
      return null
    })

  port.handleOpen(async (payload) => {
    const path = await withDraft(await openPayload(payload))
    fatal = null
    hideFatal()
    if (pendingOpen) pendingOpen = Promise.resolve(path)
    else emitReload(path)
    return { opened: true, title: payload.file.name }
  })

  // ------------------------------------------------------------ saving

  /** set while the host's `save` request runs the renderer's save flow */
  let hostSave: { error: ProtocolErrorShape | null } | null = null
  /** set while the host's `saveAs` request waits for the renderer's Save As */
  let hostSaveAs: {
    name?: string
    settle: (r: SaveResult) => void
    started: () => void
  } | null = null

  async function sendSave(send: () => Promise<SaveResult>): Promise<SaveResult> {
    try {
      const res = await send()
      if (res?.ok === true && res.file) return res
      if (res?.ok === false) return res
      return failure('malformed', 'unexpected save result')
    } catch (err) {
      return { ok: false, error: { code: errorCode(err), message: describe(err) } }
    }
  }

  /** api.open for the head metadata (etag); the bytes are not kept */
  async function headMeta(fileId: string): Promise<FileMeta | null> {
    try {
      const open = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.short })
      return open?.file?.fileId === fileId ? open.file : null
    } catch (err) {
      console.warn('[pdf-web] reading the head version failed:', err)
      return null
    }
  }

  /** after a timed-out / network-failed save: adopt the head when it looks like our own write */
  async function reconcileAfterUnknown(fileId: string, sent: Uint8Array): Promise<void> {
    const before = doc?.file
    const head = await headMeta(fileId)
    if (!head || !before?.etag || head.etag === before.etag) return
    if (head.sizeBytes === sent.byteLength && doc?.file.fileId === fileId) {
      doc = { file: { ...doc.file, ...head }, bytes: sent }
    }
  }

  async function resolveConflict(fileId: string, bytes: Uint8Array): Promise<{ ok: true } | Fail> {
    const choice = await ask({
      title: 'webConflictTitle',
      body: 'webConflictBody',
      choices: [
        { id: 'cancel', label: 'webCancel' },
        { id: 'reload', label: 'webConflictReload' },
        { id: 'overwrite', label: 'webConflictOverwrite', primary: true },
      ],
      cancelId: 'cancel',
      marker: 'conflict',
    })
    if (choice === 'overwrite') {
      const head = await headMeta(fileId)
      if (!head || doc?.file.fileId !== fileId) return fail(text('webConflictNotSaved'))
      doc = { ...doc, file: { ...doc.file, ...head } }
      return putBytes(fileId, bytes)
    }
    if (choice === 'reload') {
      try {
        const open = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.transfer })
        emitReload(await openPayload(open))
        return fail(text('webReloaded'))
      } catch (err) {
        console.error('[pdf-web] reloading the latest version failed:', err)
      }
    }
    return fail(text('webConflictNotSaved'))
  }

  /** upload new bytes of the open document as its next version (If-Match = working copy etag) */
  async function putBytes(fileId: string, bytes: Uint8Array): Promise<{ ok: true } | Fail> {
    const etag = doc?.file.fileId === fileId ? doc.file.etag : undefined
    const data = copyBuffer(bytes)
    const res = await sendSave(() =>
      port.request(
        'api.save',
        { fileId, data, ...(etag ? { etag } : {}) },
        { timeoutMs: TIMEOUTS.transfer, transfer: [data] },
      ),
    )
    if (res.ok) {
      const file: FileMeta = { ...(doc?.file ?? {}), ...res.file }
      if (res.versionId && !res.file.versionId) file.versionId = res.versionId
      adopt(file, bytes)
      restored = false
      recoveredFlag = false
      void drafts.saved()
      port.reportSaved({
        file,
        ...(file.versionId ? { versionId: file.versionId } : {}),
        initiatedByFrame: hostSave === null,
      })
      return { ok: true }
    }
    if (hostSave) hostSave.error = res.error
    if (res.error.code === 'conflict') {
      // a host `save` request gets the conflict in its result and owns the UI
      if (hostSave) return fail(text('webConflictNotSaved'))
      port.reportError(res.error, false)
      return resolveConflict(fileId, bytes)
    }
    if (res.error.code === 'timeout' || res.error.code === 'network') {
      await reconcileAfterUnknown(fileId, bytes)
    }
    return fail(res.error.code === 'timeout' ? 'save timed out' : res.error.message)
  }

  /** refusals shared by every write path */
  function writeRefusal(path: unknown): Fail | null {
    if (fatal) {
      if (hostSave) hostSave.error = fatal
      return fail(text('webFatalTitle'))
    }
    if (!can('edit')) return fail(text('webViewOnlyNoSave'))
    if (!doc || !owns(path)) return fail(NOT_GRANTED)
    return null
  }

  async function core(fonts = false): Promise<PdfCore> {
    if (fonts) await deps.ensureFonts()
    return deps.core()
  }

  /** run `op` over the working copy and upload the result in place (insert / crop / resize ...) */
  async function rewrite<R extends object>(
    path: unknown,
    op: (bytes: Uint8Array) => Promise<{ bytes: Uint8Array; extra?: R }>,
  ): Promise<({ ok: true } & Partial<R>) | Fail> {
    const refused = writeRefusal(path)
    if (refused) return refused
    const fileId = doc!.file.fileId
    let out: { bytes: Uint8Array; extra?: R }
    try {
      out = await op(doc!.bytes.slice())
    } catch (err) {
      return fail(describe(err))
    }
    const res = await putBytes(fileId, out.bytes)
    return res.ok ? { ok: true, ...(out.extra ?? {}) } : res
  }

  async function saveCopy(
    targetPath: string,
    bytes: Uint8Array,
    skips: Skips,
  ): Promise<SavePdfResult> {
    const pending = hostSaveAs
    pending?.started()
    const data = copyBuffer(bytes)
    const res = await sendSave(() =>
      port.request(
        'api.saveAs',
        {
          name: withPdf(pending?.name || nameFromSaveAsTarget(targetPath)),
          data,
          sourceFileId: doc!.file.fileId,
        },
        { timeoutMs: TIMEOUTS.dialog, transfer: [data] },
      ),
    )
    // the host learns the new file from its own request's result; this frame keeps the original
    pending?.settle(res)
    if (res.ok) {
      // the edits are in a saved file now; the writer keeps a fresh copy while still dirty
      void drafts.saved()
      return { ok: true, ...skips }
    }
    // a cancelled host dialog wrote nothing: no error, like the desktop's cancelled dialog
    if (res.error.code === 'cancelled') return { ok: true }
    return fail(res.error.message)
  }

  /** the user picks one more PDF in the host (purpose insert); null = cancelled */
  async function pickPdf(): Promise<Uint8Array | null> {
    try {
      const res = await port.request(
        'file.pick',
        { purpose: 'insert', accept: ['pdf'] },
        { timeoutMs: TIMEOUTS.dialog },
      )
      return res?.file ? await readSource(res.file.source) : null
    } catch (err) {
      if (errorCode(err) === 'cancelled') return null
      throw err
    }
  }

  async function downloadOne(name: string, bytes: Uint8Array, mime: string): Promise<string> {
    const file = safeBase(name)
    download(file, new Blob([copyBuffer(bytes)], { type: mime }))
    return file
  }

  async function downloadMany(
    zipName: string,
    files: Array<{ name: string; data: Uint8Array }>,
    mime: string,
  ): Promise<string> {
    if (files.length === 1) return downloadOne(files[0]!.name, files[0]!.data, mime)
    const name = safeBase(zipName)
    download(name, await zip(files.map((f) => ({ name: safeBase(f.name), data: f.data }))))
    return name
  }

  // ------------------------------------------------------------ host requests

  port.handleCloseCheck(() => ({ dirty: dirtyNow(), autoSave: false }))

  port.handleSave(async () => {
    if (fatal) return { ok: false, error: fatal }
    if (!doc) return failure('not_ready', 'no document is open')
    if (!can('edit')) return failure('forbidden', 'the document is view-only')
    if (hostSave) return failure('busy', 'a save is already running')
    hostSave = { error: null }
    try {
      const ok = await runRendererSave()
      if (ok && doc) {
        return {
          ok: true,
          file: { ...doc.file },
          ...(doc.file.versionId ? { versionId: doc.file.versionId } : {}),
        }
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
    if (!doc) return failure('not_ready', 'no document is open')
    if (hostSaveAs) return failure('busy', 'a save-as is already running')
    const target = saveAsTarget(payload?.name || doc.file.name)
    return new Promise<SaveResult>((resolve) => {
      // bounded wait for the renderer to reach pdfApi.save (it applies the edits first); the
      // host's name/folder dialog after that has no timeout (TIMEOUTS.dialog)
      const timer = setTimeout(
        () => settle(failure('timeout', 'the viewer did not start Save As')),
        TIMEOUTS.editorStart,
      )
      const entry = {
        ...(payload?.name ? { name: payload.name } : {}),
        settle: (r: SaveResult) => settle(r),
        started: () => clearTimeout(timer),
      }
      function settle(r: SaveResult): void {
        clearTimeout(timer)
        if (hostSaveAs === entry) hostSaveAs = null
        resolve(r)
      }
      hostSaveAs = entry
      if (saveAsHandlers.size === 0) {
        settle(failure('not_ready', 'no viewer is listening'))
        return
      }
      for (const h of saveAsHandlers) h(target)
    })
  })

  port.handlePrint(async (payload) => {
    if (payload?.mode === 'pdf') {
      // the document already is a PDF: hand the user the current version
      if (!doc) return { printed: false }
      await downloadOne(doc.file.name, doc.bytes, 'application/pdf')
      return { printed: true }
    }
    if (printHandlers.size === 0) return { printed: false }
    for (const h of printHandlers) h()
    return { printed: true }
  })

  // ------------------------------------------------------------ pdfApi

  const ai = aiStub as unknown as Pick<
    PdfWebApi,
    'getAiSettings' | 'aiStream' | 'aiStreamCancel' | 'onAiStream' | 'imageSearch' | 'fetchImage'
  >

  const api: PdfWebApi = {
    // ---- open / read
    async consumePending() {
      const pending = pendingOpen
      pendingOpen = null
      return pending ? await pending : currentPath()
    },
    async readFile(path) {
      if (!doc || !owns(path)) throw new Error(NOT_GRANTED)
      return copyBuffer(doc.bytes)
    },
    onReloadRequest(handler) {
      reloadListeners.add(handler)
      return () => {
        reloadListeners.delete(handler)
      }
    },
    provideSaveRequest(provider) {
      saveRequestProvider = provider
      return () => {
        if (saveRequestProvider === provider) saveRequestProvider = null
      }
    },
    consumeRecovered() {
      const flag = recoveredFlag
      recoveredFlag = false
      return flag
    },

    // ---- save
    async save(request: SavePdfRequest): Promise<SavePdfResult> {
      const refused = writeRefusal(request?.path)
      if (refused) return refused
      const fileId = doc!.file.fileId
      let bytes: Uint8Array
      let skips: Skips
      try {
        ;({ bytes, skips } = await applyRequest(doc!.bytes.slice(), request))
      } catch (err) {
        return fail(describe(err))
      }
      if (typeof request.targetPath === 'string' && request.targetPath !== request.path) {
        return saveCopy(request.targetPath, bytes, skips)
      }
      const res = await putBytes(fileId, bytes)
      return res.ok ? { ok: true, ...skips } : res
    },
    setDirty(dirty) {
      rendererDirty = dirty === true
      port.setDirty(dirtyNow())
    },
    onCloseSaveRequest(handler) {
      closeSaveHandlers.add(handler)
      return () => {
        closeSaveHandlers.delete(handler)
      }
    },
    sendCloseSaveResult(ok) {
      for (const w of closeSaveWaiters.slice()) w(ok === true)
    },
    onSaveAsRequest(handler) {
      saveAsHandlers.add(handler)
      return () => {
        saveAsHandlers.delete(handler)
      }
    },
    sendSaveAsResult(ok) {
      // the renderer gave up before reaching pdfApi.save (nothing was sent to the host)
      hostSaveAs?.settle(
        ok
          ? failure('internal', 'save as did not complete')
          : failure('internal', 'save as failed'),
      )
    },
    onSaveAsFlow: () => () => {},
    onPrintRequest(handler) {
      printHandlers.add(handler)
      return () => {
        printHandlers.delete(handler)
      }
    },

    // ---- in-frame readers (save core on the working copy)
    async listStaticFormFills(path) {
      if (!doc || !owns(path)) throw new Error(NOT_GRANTED)
      return (await core()).readStaticFormFills(doc.bytes.slice())
    },
    async validateTextEdits(request) {
      if (!doc || !owns(request?.path) || !Array.isArray(request.edits))
        throw new Error(NOT_GRANTED)
      return (await core(true)).validateTextEdits(doc.bytes.slice(), request.edits)
    },
    async listEditFonts() {
      return (await core(true)).listEditFonts()
    },
    async canDrawText(textToDraw, font, bold, italic) {
      if (typeof textToDraw !== 'string') return false
      return (await core(true)).canDrawText(textToDraw, font, bold === true, italic === true)
    },
    async listPageImages(path) {
      if (!doc || !owns(path)) throw new Error(NOT_GRANTED)
      return (await core()).listPageImages(doc.bytes.slice())
    },
    async pageImagePng(request) {
      if (!doc || !owns(request?.path)) throw new Error(NOT_GRANTED)
      const scale =
        typeof request.scale === 'number' && Number.isFinite(request.scale) ? request.scale : 1
      return (await core()).renderImagePng(
        doc.bytes.slice(),
        request.pageIndex,
        request.rect,
        scale,
      )
    },
    async pagePreviewPng(request) {
      if (!doc || !owns(request?.path)) throw new Error(NOT_GRANTED)
      const { pageIndex, excludeRects, excludeAnnots, clip, pxWidth, rotate } = request
      return (await core()).renderPagePreviewPng(doc.bytes.slice(), {
        pageIndex,
        excludeRects,
        excludeAnnots,
        clip,
        pxWidth,
        rotate,
      })
    },

    // ---- page operations in place (the desktop rewrites the file, here: a new version)
    insertBlankPage: (request) =>
      rewrite(request?.path, async (bytes) => ({
        bytes: await (
          await core()
        ).insertBlankPageBytes(
          bytes,
          typeof request.afterPageIndex === 'number' ? request.afterPageIndex : -1,
        ),
      })),
    async setPageSize(request) {
      const { width, height } = request ?? {}
      if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
        return fail('pdf: invalid page size')
      }
      return rewrite(request.path, async (bytes) => ({
        bytes: await (await core()).setPageSizeBytes(bytes, width, height),
      }))
    },
    async cropPages(request) {
      if (!Array.isArray(request?.pages) || request.pages.length === 0 || !request.rect) {
        return fail(NOT_GRANTED)
      }
      return rewrite(request.path, async (bytes) => ({
        bytes: await (await core()).cropPagesBytes(bytes, request.pages, request.rect),
      }))
    },
    async insertPdf(request) {
      if (!can('insertPages')) return fail(NOT_AVAILABLE)
      const refused = writeRefusal(request?.path)
      if (refused) return refused
      let other: Uint8Array | null
      try {
        other = await pickPdf()
      } catch (err) {
        return fail(describe(err))
      }
      if (!other) return { ok: true, canceled: true }
      const picked = other
      const res = await rewrite<{ insertedCount: number }>(request.path, async (bytes) => {
        const { merged, count } = await (
          await core()
        ).insertPdfBytes(
          bytes,
          picked,
          typeof request.afterPageIndex === 'number' ? request.afterPageIndex : -1,
        )
        return { bytes: merged, extra: { insertedCount: count } }
      })
      return res.ok ? { ok: true, insertedCount: res.insertedCount ?? 0 } : res
    },
    async replacePages(request) {
      if (!can('insertPages')) return fail(NOT_AVAILABLE)
      if (!Array.isArray(request?.pages) || request.pages.length === 0) return fail(NOT_GRANTED)
      const refused = writeRefusal(request.path)
      if (refused) return refused
      let other: Uint8Array | null
      try {
        other = await pickPdf()
      } catch (err) {
        return fail(describe(err))
      }
      if (!other) return { ok: true, canceled: true }
      const picked = other
      const res = await rewrite<{ removed: number; inserted: number }>(
        request.path,
        async (bytes) => {
          const { merged, removed, inserted } = await (
            await core()
          ).replacePagesBytes(bytes, picked, request.pages)
          return { bytes: merged, extra: { removed, inserted } }
        },
      )
      return res.ok ? { ok: true, removed: res.removed ?? 0, inserted: res.inserted ?? 0 } : res
    },

    // ---- new files -> downloads (the desktop writes them next to the default folder)
    async extractPages(request) {
      if (!doc || !owns(request?.path) || !Array.isArray(request.pages)) return fail(NOT_GRANTED)
      try {
        const bytes = await (await core()).extractPagesBytes(doc.bytes.slice(), request.pages)
        return {
          ok: true,
          savedPath: await downloadOne(
            withPdf(request.suggestedName || 'pages.pdf'),
            bytes,
            'application/pdf',
          ),
        }
      } catch (err) {
        return fail(describe(err))
      }
    },
    async splitPdf(request) {
      if (!doc || !owns(request?.path)) return fail(NOT_GRANTED)
      try {
        const parts = await (
          await core()
        ).splitPdfBytes(
          doc.bytes.slice(),
          typeof request.chunkSize === 'number' ? request.chunkSize : 1,
        )
        const base = safeBase(request.baseName || 'split')
        const savedDir = await downloadMany(
          `${base}.zip`,
          parts.map((data, i) => ({ name: `${base}-${i + 1}.pdf`, data })),
          'application/pdf',
        )
        return { ok: true, savedDir, count: parts.length }
      } catch (err) {
        return fail(describe(err))
      }
    },
    async mergePdf(request) {
      if (!doc || !owns(request?.path)) return fail(NOT_GRANTED)
      if (!can('insertPages')) return fail(NOT_AVAILABLE)
      const others: Uint8Array[] = []
      try {
        // no multi-select picker in the protocol: one pick at a time until "merge now"
        for (;;) {
          const picked = await pickPdf()
          if (picked) others.push(picked)
          if (!picked || others.length === 0) break
          const next = await ask({
            title: 'webMergeTitle',
            body: 'webMergeBody',
            params: { count: others.length + 1 },
            choices: [
              { id: 'cancel', label: 'webCancel' },
              { id: 'add', label: 'webMergeAdd' },
              { id: 'merge', label: 'webMergeNow', primary: true },
            ],
            cancelId: 'cancel',
            marker: 'merge',
          })
          if (next === 'cancel') return { ok: true, canceled: true }
          if (next === 'merge') break
        }
        if (others.length === 0) return { ok: true, canceled: true }
        const { merged, appended } = await (await core()).mergePdfBytes(doc.bytes.slice(), others)
        const savedPath = await downloadOne(
          withPdf(request.suggestedName || 'merged.pdf'),
          merged,
          'application/pdf',
        )
        return { ok: true, savedPath, appendedCount: appended }
      } catch (err) {
        return fail(describe(err))
      }
    },
    async mergePages(request) {
      if (!doc || !owns(request?.path)) return fail(NOT_GRANTED)
      const { perSheet, direction, separator } = request
      if (!Number.isInteger(perSheet) || perSheet < 2 || perSheet > 16) {
        return fail('pdf: pages-per-sheet must be 2-16')
      }
      try {
        const bytes = await (
          await core()
        ).mergePagesBytes(doc.bytes.slice(), {
          perSheet,
          direction: direction === 'horizontal' ? 'horizontal' : 'vertical',
          separator: separator === true,
        })
        return {
          ok: true,
          savedPath: await downloadOne(
            withPdf(request.suggestedName || 'merged-pages.pdf'),
            bytes,
            'application/pdf',
          ),
        }
      } catch (err) {
        return fail(describe(err))
      }
    },
    async splitPages(request) {
      if (!doc || !owns(request?.path)) return fail(NOT_GRANTED)
      if (request.perPage !== 2 && request.perPage !== 4 && request.perPage !== 9) {
        return fail('pdf: unsupported split grid')
      }
      try {
        const bytes = await (await core()).splitPagesBytes(doc.bytes.slice(), request.perPage)
        return {
          ok: true,
          savedPath: await downloadOne(
            withPdf(request.suggestedName || 'split-pages.pdf'),
            bytes,
            'application/pdf',
          ),
        }
      } catch (err) {
        return fail(describe(err))
      }
    },
    async exportImages(request) {
      const { images, pageNumbers, baseName } = request ?? {}
      if (!Array.isArray(images) || images.length === 0) return fail('pdf: no images')
      try {
        const base = safeBase(baseName || 'page')
        const files = images.map((b64, i) => {
          const bin = atob(b64)
          const data = new Uint8Array(bin.length)
          for (let j = 0; j < bin.length; j++) data[j] = bin.charCodeAt(j)
          return { name: `${base}-p${pageNumbers?.[i] ?? i + 1}.png`, data }
        })
        const savedDir = await downloadMany(`${base}-images.zip`, files, 'image/png')
        return { ok: true, savedDir, count: images.length }
      } catch (err) {
        return fail(describe(err))
      }
    },

    // ---- saved signatures (encrypted with the recovery key, per user)
    listSavedSignatures: () => signatures.list(),
    addSavedSignature: (data) => signatures.add(data),
    removeSavedSignature: (id) => signatures.remove(id),

    // ---- viewer identity, appearance
    getUsername: async () => author,
    getLanguage: browser.getLanguage as PdfWebApi['getLanguage'],
    onLanguageChanged: browser.onLanguageChanged as PdfWebApi['onLanguageChanged'],
    getTheme: browser.getTheme as PdfWebApi['getTheme'],
    onThemeChanged: browser.onThemeChanged as PdfWebApi['onThemeChanged'],
    onChromePressed: () => () => {},

    // ---- hidden on the web (capabilities in ./install.ts); safe typed answers
    consumeAiPreset: async () => null,
    onAiPreset: () => () => {},
    autoRename: async () => ({ renamed: false }),
    isUntitled: async () => false,
    // null = "no OCR engine on this platform": the viewer stops trying
    ocrPage: async () => null,
    convertOffice: async () => {},
    createDocument: async () => ({ ok: false, error: NOT_AVAILABLE }),
    generateImage: async () => ({ error: NOT_AVAILABLE }),
    getAiPanelPrefs: async () => ({ ...DEFAULT_AI_PANEL_PREFS }),
    onAiPanelPrefsChanged: () => () => {},
    gskStatus: async () => ({ loggedIn: false }),
    getAiSettings: ai.getAiSettings,
    setAiSettings: async () => {},
    onAiSettingsChanged: () => () => {},
    openAiModelSettings: async () => {},
    setAiPanelPrefs: async () => ({ ...DEFAULT_AI_PANEL_PREFS }),
    requestRedactionCopy: async () => false,
    // the host's file.renamed only renames: the web document id (its "path") never changes
    onFileRenamed: () => () => {},
    aiStream: ai.aiStream,
    aiStreamCancel: ai.aiStreamCancel,
    onAiStream: ai.onAiStream,
    imageSearch: ai.imageSearch,
    fetchImage: ai.fetchImage,
  }

  return {
    api,
    /** test / diagnostics: the working copy */
    workingCopy: () => (doc ? { file: { ...doc.file }, bytes: doc.bytes.slice() } : null),
  }
}
