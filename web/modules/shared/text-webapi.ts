/**
 * Web API of the text-document modules (Markdown, HTML; GO-B4 M-1 / H-1): the file members of
 * window.markdownApi / window.htmlApi over the frame protocol, the pattern of the Docs bridge
 * (web/docs/bridge/webapi.ts + session.ts) for editors whose document is UTF-8 text.
 *
 * | preload member                     | web                                                                   |
 * |------------------------------------|-----------------------------------------------------------------------|
 * | consumePending / readFile          | init.open, else api.open {fileId: init.documentId}; bytes -> text     |
 * |                                    | (./text-codec.ts keeps BOM + EOL; the renderer's envelope does the rest)|
 * | save {mode:'save'}                 | api.save {fileId, data, etag}; never `auto` (CONTRACT C10)            |
 * | save {mode:'saveAs'} / untitled    | api.saveAs {name, data, sourceFileId} (host dialog; silent when named) |
 * | save conflict (frame-initiated)    | dialog Cancel / Reload latest / Overwrite (./notice.ts)               |
 * | setDirty                           | `dirty` event; host `doc.closeCheck` answers {dirty, autoSave:false}  |
 * | onSaveRequest / sendSaveRequestAck | host `save` {reason:'user'} / `saveAs`                                 |
 * | onCloseSaveRequest / sendClose...  | host `save` {reason:'navigate'} (the renderer's close-save flow)       |
 * | onFileRenamed                      | host event `file.renamed`                                             |
 * | onExportRequest('pdf') + exportPdf | host `print`: the renderer builds its print HTML, the bridge prints it |
 * |                                    | in a script-less srcdoc frame (./print.ts); no server route (decision 5)|
 * | exportDocx / exportHtml            | browser download of the bytes the renderer built                      |
 * | pickImage / saveImage / readImage  | ./assets.ts (api.images.upload with the `images` grant, else data: URI)|
 * | resolveAssetUrl / unresolveAssetUrl| web-only: OpenPayload.assets map for relative pictures                |
 * | consumeHeadlessExport              | null (no headless web export)                                         |
 * | provideText / consumeRecovered     | web-only, draft recovery (C18): ../../docs/bridge/draft-recovery.ts   |
 * |                                    | keeps an encrypted copy of the renderer's text every 30 s while dirty;|
 * |                                    | offered before the renderer loads (Restore = dirty document)          |
 *
 * View-only: the host withholds `save` (protocol README "Read-only documents"). The renderer reads
 * `cap('save')` and turns editing off; the bridge refuses every write as well. A file whose bytes
 * are not valid UTF-8 is view-only too: saving its decoded text would rewrite it.
 *
 * Opening another document: these renderers load one document at boot (consumePending), so a
 * host `open` before boot replaces the pending document and one after boot is refused
 * (`unsupported`: the host opens a new frame). "Reload latest" after a conflict reloads the frame:
 * the host re-runs the handshake (host.ts: a later `ready` restarts it) and the renderer boots on
 * the newest version.
 */
import {
  toProtocolError,
  type FileMeta,
  type FileSource,
  type OfficeModule,
  type OpenPayload,
  type ProtocolErrorShape,
  type SaveResult,
} from '../../docs/protocol/types'
import { downloadBlob, pickFiles } from '../../docs/bridge/browser'
import { TIMEOUTS, errorCode } from '../../docs/bridge/frame-port'
import { ownHeadAfterUnknown } from '../../docs/bridge/head-match'
import type { ModuleBridgePort } from '../../docs/bridge/module-bridge'
import type { DraftHost, DraftRecovery } from '../../docs/bridge/draft-recovery'
import { createAssetStore } from './assets'
import { ask, hideFatal, showFatal, text } from './notice'
import { printHtmlDocument } from './print'
import { bridgeDraftRecovery } from './recovery-prompt'
import { decodeText, encodeText } from './text-codec'

// ---------------------------------------------------------------- paths

const PATH_PREFIX = 'uniwork://files/'

/** the renderers treat a path as opaque and show `path.split(/[\\/]/).pop()` */
export function pathFor(file: { fileId: string; name: string }): string {
  return `${PATH_PREFIX}${file.fileId}/${file.name}`
}

export function idFromPath(path: string | null | undefined): string | null {
  if (typeof path !== 'string' || !path.startsWith(PATH_PREFIX)) return null
  const rest = path.slice(PATH_PREFIX.length)
  const slash = rest.indexOf('/')
  return slash > 0 ? rest.slice(0, slash) : null
}

// ---------------------------------------------------------------- types

export type SaveMode = 'save' | 'saveAs'
/** the only export a host can start on the web: `print` -> the renderer's PDF flow */
export type HostExport = 'pdf'

export interface TextSaveRequest {
  text: string
  imageSources?: string[]
  mode: SaveMode
  suggestedName?: string
  defaultName?: string
}

export type TextSaveResult =
  | { ok: true; path: string; imageRewrites?: Array<{ from: string; to: string }> }
  | { ok: true; canceled: true }
  | { ok: false; error: string }

export type ExportResult =
  { ok: true; path: string } | { ok: true; canceled: true } | { ok: false; error: string }

export interface TextModuleConfig {
  /** module id (draft records, CONTRACT C18) */
  module: Extract<OfficeModule, 'markdown' | 'html'>
  /** extension of new / saved-as files, with the dot ('.md', '.html') */
  ext: string
  /** extensions stripped from a suggested name before `ext` is added */
  extPattern: RegExp
  /** MIME type of the document (downloads) */
  mimeType: string
}

export interface TextWebApiOptions {
  /** the print path (default: ./print.ts, script-less srcdoc frame); injectable for tests */
  print?: (html: string) => Promise<{ ok: boolean; error?: string }>
  /** turns the renderer's print HTML into what is printed (HTML module: a static copy) */
  printable?: (html: string, resolveAsset: (src: string) => string | null) => string
  /** how long a host-requested save may take before the host gets ok:false (ms) */
  saveTimeoutMs?: number
  /** "Reload latest" (default: location.reload()); injectable for tests */
  reload?: () => void
  /**
   * the renderer's capability object (module-bridge): `save` is turned off when the opened
   * file cannot be saved back faithfully (not UTF-8), so the renderer goes view-only
   */
  capabilities?: Record<string, unknown>
  /** draft recovery (C18; default: IndexedDB + the shared prompt); injectable for tests */
  drafts?: (host: DraftHost) => DraftRecovery
}

type Waiter<T> = { settle: (r: T) => void; started: () => void } | null

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function failure(code: ProtocolErrorShape['code'], message: string): SaveResult {
  return { ok: false, error: { code, message } }
}

function copyBuffer(bytes: ArrayBuffer): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(new Uint8Array(bytes))
  return out
}

async function readSource(source: FileSource): Promise<ArrayBuffer> {
  if (source.kind === 'bytes') return copyBuffer(source.data)
  const res = await fetch(source.url, { credentials: 'omit', headers: source.headers })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  return res.arrayBuffer()
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

// ---------------------------------------------------------------- factory

export function createTextWebApi(
  port: ModuleBridgePort,
  config: TextModuleConfig,
  opts: TextWebApiOptions = {},
) {
  const withExt = (name: string): string => name.replace(config.extPattern, '') + config.ext

  /** fileId -> latest server metadata (etag = If-Match base of the next save) */
  const files = new Map<string, FileMeta>()
  /** path -> decoded text of an opened document (readFile) */
  const texts = new Map<string, string>()
  let current: string | null = null
  let dirty = false
  /** host withheld `save` */
  let saveGranted = false
  /** the open document is not valid UTF-8 */
  let inexact = false
  let fatal: ProtocolErrorShape | null = null
  let booted = false

  const assets = createAssetStore(port, {
    fileId: () => current,
    canUpload: () => imagesGranted,
  })
  let imagesGranted = false

  const viewOnly = (): boolean => !saveGranted || inexact

  // ------------------------------------------------------------ draft recovery (C18)

  /** the document `init` names: the only one the host's draft scope ("<user>:<document>") covers */
  let initDocumentId: string | null = null
  /** the renderer's "text a save would write now" (web-only preload member provideText) */
  let textProvider: (() => string | null) | null = null
  let restoredDraft: ArrayBuffer | null = null
  /** server text the restored draft replaced; the renderer reads it once (consumeRecovered) */
  let recoveredBase: string | null = null
  const drafts = (opts.drafts ?? ((host) => bridgeDraftRecovery(port, config.module, host)))({
    file: () => {
      // a view-only document is never drafted (nothing could save it back)
      if (viewOnly() || current === null || current !== initDocumentId) return null
      const file = files.get(current)
      return file ? { etag: file.etag, name: file.name } : null
    },
    isDirty: () => dirty && !viewOnly(),
    bytes: async () => {
      const live = textProvider?.()
      return typeof live === 'string' ? encodeText(live) : null
    },
    restore: (bytes) => {
      restoredDraft = bytes
    },
  })

  /**
   * Offer the document's draft before the renderer loads it: Restore swaps the text readFile
   * returns for the draft's and flags the open as recovered (the renderer starts dirty).
   */
  async function withDraft(path: string): Promise<string> {
    restoredDraft = null
    recoveredBase = null
    await drafts.opened()
    const data = restoredDraft as ArrayBuffer | null
    restoredDraft = null
    if (data) {
      recoveredBase = texts.get(path) ?? ''
      texts.set(path, decodeText(data).text)
    }
    return path
  }

  function remember(file: FileMeta): void {
    files.set(file.fileId, { ...files.get(file.fileId), ...file })
    current = file.fileId
  }

  function currentFile(): FileMeta | null {
    return current ? (files.get(current) ?? null) : null
  }

  async function accept(open: OpenPayload): Promise<string> {
    const decoded = decodeText(await readSource(open.source))
    remember(open.file)
    assets.reset(open.assets)
    inexact = !decoded.exact
    if (inexact) {
      console.warn(`[office-web] ${open.file.name} is not valid UTF-8: opened view only`)
      if (opts.capabilities) opts.capabilities.save = false
    }
    const path = pathFor(open.file)
    texts.set(path, decoded.text)
    port.setTitle(open.file.name)
    return path
  }

  async function openById(fileId: string): Promise<string> {
    return accept(await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.transfer }))
  }

  function setFatal(err: unknown): void {
    fatal = toProtocolError(err).toShape()
    showFatal(fatal.code === 'not_ready' && window.parent === window ? 'webNoHost' : 'webFatalBody')
  }

  let pendingOpen: Promise<string | null> | null = port
    .whenInitialized()
    .then((s) => {
      saveGranted = s.capabilities?.save === true
      imagesGranted = s.capabilities?.images === true
      initDocumentId = s.documentId
      return s.open ? accept(s.open) : openById(s.documentId)
    })
    .then(withDraft)
    .catch((err: unknown) => {
      console.error('[office-web] initial open failed:', err)
      port.reportError(err, true)
      setFatal(err)
      return null
    })

  port.handleOpen(async (payload) => {
    if (booted) {
      throw toProtocolError({
        code: 'unsupported',
        message: 'this editor opens one document per frame load; open a new frame',
      })
    }
    const path = accept(payload).then(withDraft)
    pendingOpen = path
    await path
    fatal = null
    hideFatal()
    return { opened: true, title: payload.file.name }
  })

  // ------------------------------------------------------------ host save / saveAs / print

  const saveHandlers = new Set<(mode: SaveMode) => void>()
  const closeSaveHandlers = new Set<() => void>()
  const exportHandlers = new Set<(format: HostExport) => void>()
  const printHandlers = new Set<() => void>()
  const renameHandlers = new Set<(path: string) => void>()

  /** set while a host `save` runs the renderer's save flow */
  let hostSave: Waiter<SaveResult> = null
  /** set while a host `saveAs` waits for the renderer's save({mode:'saveAs'}) */
  let hostSaveAs: (NonNullable<Waiter<SaveResult>> & { name?: string }) | null = null
  /** set while a host `print` waits for the renderer's exportPdf */
  let hostPrint: Waiter<{ printed: boolean }> = null

  function okResult(): SaveResult {
    const file = currentFile()
    if (!file) return failure('not_ready', 'no document is open')
    return { ok: true, file, ...(file.versionId ? { versionId: file.versionId } : {}) }
  }

  function runHostFlow<T>(
    start: () => boolean,
    timeoutMs: number,
    onTimeout: () => T,
    install: (w: NonNullable<Waiter<T>>) => void,
    clear: () => void,
    notListening: () => T,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => settle(onTimeout()), timeoutMs)
      const settle = (r: T) => {
        clearTimeout(timer)
        clear()
        resolve(r)
      }
      install({ settle, started: () => clearTimeout(timer) })
      if (!start()) settle(notListening())
    })
  }

  port.handleSave(async (payload) => {
    if (fatal) return { ok: false, error: fatal }
    if (viewOnly()) return failure('forbidden', text('webViewOnlyNotSaved'))
    if (!current) return failure('not_ready', 'no document is open')
    if (!dirty) return okResult()
    if (hostSave || hostSaveAs) return failure('busy', 'a save is already running')
    const navigate = payload?.reason === 'navigate'
    return runHostFlow<SaveResult>(
      () => {
        if (navigate && closeSaveHandlers.size > 0) {
          for (const h of closeSaveHandlers) h()
          return true
        }
        for (const h of saveHandlers) h('save')
        return saveHandlers.size > 0
      },
      opts.saveTimeoutMs ?? 180_000,
      () => failure('timeout', 'save did not complete'),
      (w) => {
        hostSave = w
      },
      () => {
        hostSave = null
      },
      () => failure('not_ready', 'no editor is listening'),
    )
  })

  port.handleSaveAs(async (payload) => {
    if (fatal) return { ok: false, error: fatal }
    if (viewOnly()) return failure('forbidden', text('webViewOnlyNotSaved'))
    if (hostSave || hostSaveAs) return failure('busy', 'a save is already running')
    return runHostFlow<SaveResult>(
      () => {
        for (const h of saveHandlers) h('saveAs')
        return saveHandlers.size > 0
      },
      // bounded wait for the renderer to reach save(); the host dialog after that has none
      TIMEOUTS.editorStart,
      () => failure('timeout', 'the editor did not start Save As'),
      (w) => {
        hostSaveAs = { ...w, ...(payload?.name ? { name: payload.name } : {}) }
      },
      () => {
        hostSaveAs = null
      },
      () => failure('not_ready', 'no editor is listening'),
    )
  })

  port.handlePrint(async () => {
    // both modes print the renderer's print HTML in the browser dialog (no server PDF route)
    if (hostPrint) return { printed: false }
    return runHostFlow<{ printed: boolean }>(
      () => {
        for (const h of exportHandlers) h('pdf')
        if (exportHandlers.size > 0) return true
        for (const h of printHandlers) h()
        if (printHandlers.size > 0) hostPrint?.settle({ printed: true })
        return printHandlers.size > 0
      },
      TIMEOUTS.editorStart,
      () => ({ printed: false }),
      (w) => {
        hostPrint = w
      },
      () => {
        hostPrint = null
      },
      () => ({ printed: false }),
    )
  })

  port.handleCloseCheck(() => ({ dirty: dirty && !viewOnly(), autoSave: false }))

  port.onFileRenamed((file) => {
    const prev = files.get(file.fileId)
    if (!prev || prev.name === file.name) return
    files.set(file.fileId, { ...prev, ...file })
    const path = pathFor({ ...prev, ...file })
    texts.set(path, texts.get(pathFor(prev)) ?? '')
    if (file.fileId === current) port.setTitle(file.name)
    for (const h of renameHandlers) h(path)
  })

  // ------------------------------------------------------------ saving

  /** api.save / api.saveAs: a rejection and an ok:false result are both failures */
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

  function landed(res: Extract<SaveResult, { ok: true }>, frameInitiated: boolean): string {
    const file = { ...res.file }
    if (res.versionId && !file.versionId) file.versionId = res.versionId
    remember(file)
    void drafts.saved()
    port.reportSaved({
      file: files.get(file.fileId)!,
      ...(res.versionId ? { versionId: res.versionId } : {}),
      initiatedByFrame: frameInitiated,
    })
    port.setTitle(file.name)
    return pathFor(file)
  }

  async function headMeta(fileId: string): Promise<FileMeta | null> {
    try {
      const open = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.short })
      return open?.file?.fileId === fileId ? open.file : null
    } catch (err) {
      console.warn('[office-web] reading the head version failed:', err)
      return null
    }
  }

  /** a timed-out / network-failed save may still have landed: adopt the head when its bytes are ours */
  async function reconcileAfterUnknown(
    fileId: string,
    sent: ArrayBuffer | Uint8Array,
  ): Promise<void> {
    const head = await ownHeadAfterUnknown(port, fileId, files.get(fileId)?.etag, sent)
    if (head) remember(head)
  }

  async function saveExisting(fileId: string, data: string): Promise<TextSaveResult> {
    const etag = files.get(fileId)?.etag
    const bytes = encodeText(data)
    const size = bytes.byteLength
    const res = await sendSave(() =>
      port.request(
        'api.save',
        { fileId, data: bytes, ...(etag ? { etag } : {}) },
        { timeoutMs: TIMEOUTS.transfer, transfer: [bytes] },
      ),
    )
    const host = hostSave
    if (res.ok) {
      const path = landed(res, host === null)
      host?.settle(res)
      return { ok: true, path }
    }
    if (res.error.code === 'conflict') {
      // a host `save` gets the conflict in its result and owns the UI
      if (host) {
        host.settle(res)
        return { ok: false, error: text('webConflictNotSaved') }
      }
      port.reportError(res.error, false)
      return resolveConflict(fileId, data)
    }
    if (res.error.code === 'timeout' || res.error.code === 'network') {
      // `bytes` was transferred to the host (detached): encoding is deterministic, so rebuild them
      await reconcileAfterUnknown(fileId, encodeText(data))
    }
    host?.settle(res)
    return { ok: false, error: res.error.code === 'timeout' ? 'save timed out' : res.error.message }
  }

  async function resolveConflict(fileId: string, data: string): Promise<TextSaveResult> {
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
      if (!head) return { ok: false, error: text('webConflictNotSaved') }
      remember(head)
      return saveExisting(fileId, data)
    }
    if (choice === 'reload') {
      // the frame reloads and the host re-runs the handshake: the renderer boots on the newest
      // version. The unsaved edits are dropped on purpose (that is what "Reload latest" means).
      dirty = false
      port.setDirty(false)
      // the dropped edits must not come back as a draft after the reload
      await drafts.saved()
      ;(opts.reload ?? (() => location.reload()))()
    }
    return { ok: false, error: text('webConflictNotSaved') }
  }

  async function saveNew(
    request: TextSaveRequest,
    pending: typeof hostSaveAs,
  ): Promise<TextSaveResult> {
    const prev = currentFile()
    const silent = request.mode === 'save' && !prev && !!request.suggestedName
    const name = withExt(
      pending?.name ||
        (silent ? request.suggestedName : undefined) ||
        prev?.name ||
        request.defaultName ||
        request.suggestedName ||
        'Untitled',
    )
    const bytes = encodeText(request.text)
    const res = await sendSave(() =>
      port.request(
        'api.saveAs',
        {
          name,
          data: bytes,
          ...(prev ? { sourceFileId: prev.fileId } : {}),
          ...(silent ? { silent: true } : {}),
        },
        { timeoutMs: silent ? TIMEOUTS.transfer : TIMEOUTS.dialog, transfer: [bytes] },
      ),
    )
    const host = pending ?? hostSave
    if (res.ok) {
      const path = landed(res, host === null)
      texts.set(path, request.text)
      host?.settle(res)
      return { ok: true, path }
    }
    host?.settle(res)
    // a cancelled host dialog: nothing saved, no error (like the desktop's dialog cancel)
    if (res.error.code === 'cancelled') return { ok: true, canceled: true }
    return { ok: false, error: res.error.message }
  }

  // ------------------------------------------------------------ exports

  async function printDocument(html: string, name: string): Promise<ExportResult> {
    const printable = opts.printable ? opts.printable(html, assets.resolve) : html
    const r = await (opts.print ?? printHtmlDocument)(printable)
    hostPrint?.settle({ printed: r.ok })
    return r.ok
      ? { ok: true, path: `${withExt(name || 'document').replace(config.extPattern, '')}.pdf` }
      : { ok: false, error: r.error ?? 'print failed' }
  }

  /** single-file HTML: mapped document pictures inlined as data: URIs (desktop parity) */
  async function inlineAssets(html: string): Promise<string> {
    let out = html
    const seen = new Set<string>()
    for (const m of html.matchAll(
      /(?:src|href)\s*=\s*(["'])([^"']+)\1|url\(\s*(["']?)([^"')]+)\3\s*\)/gi,
    )) {
      const src = (m[2] ?? m[4] ?? '').trim()
      if (!src || seen.has(src) || !assets.resolve(src)) continue
      seen.add(src)
      const bytes = await assets.read(src)
      if (!bytes) continue
      out = out.split(src).join(`data:${bytes.mime};base64,${bytes.base64}`)
    }
    return out
  }

  // ------------------------------------------------------------ preload members

  return {
    /** false = the host withheld `save` or the file is not UTF-8 (renderer: cap('save')) */
    isViewOnly: viewOnly,

    async consumePending(): Promise<string | null> {
      booted = true
      const pending = pendingOpen
      pendingOpen = null
      return pending ? await pending : null
    },

    /**
     * web-only (C18): the renderer registers how to read its current text (what a save would
     * write) without saving; the draft writer calls it while the document is dirty
     */
    provideText(provider: () => string | null): () => void {
      textProvider = provider
      return () => {
        if (textProvider === provider) textProvider = null
      }
    },

    /**
     * web-only (C18): after consumePending, the server text a restored draft replaced (the
     * renderer opens the draft as a dirty document); null = not a restored draft. Read once.
     */
    consumeRecovered(): string | null {
      const base = recoveredBase
      recoveredBase = null
      return base
    },

    async consumeHeadlessExport(): Promise<null> {
      return null
    },

    headlessExportDone(): void {},

    async readFile(path: string): Promise<string> {
      const known = texts.get(path)
      if (known !== undefined) return known
      const fileId = idFromPath(path)
      if (!fileId) throw new Error('not a UniWork document')
      return texts.get(await openById(fileId)) ?? ''
    },

    async save(request: TextSaveRequest): Promise<TextSaveResult> {
      const pendingAs = hostSaveAs
      pendingAs?.started()
      const refuse = (error: ProtocolErrorShape, message: string): TextSaveResult => {
        ;(pendingAs ?? hostSave)?.settle({ ok: false, error })
        return { ok: false, error: message }
      }
      if (fatal) return refuse(fatal, text('webFatalTitle'))
      if (viewOnly()) {
        const message = text('webViewOnlyNotSaved')
        return refuse({ code: 'forbidden', message }, message)
      }
      if (typeof request?.text !== 'string') {
        return refuse({ code: 'malformed', message: 'no text' }, 'no text')
      }
      if (request.mode === 'saveAs' || pendingAs || !current) return saveNew(request, pendingAs)
      return saveExisting(current, request.text)
    },

    setDirty(next: boolean): void {
      dirty = next === true
      port.setDirty(dirty && !viewOnly())
    },

    onSaveRequest(handler: (mode: SaveMode) => void): () => void {
      saveHandlers.add(handler)
      return () => {
        saveHandlers.delete(handler)
      }
    },

    /** the renderer's save flow ended without calling save() (busy / not ready) */
    sendSaveRequestAck(ok: boolean): void {
      hostSaveAs?.settle(ok ? okResult() : failure('internal', 'save did not complete'))
      hostSave?.settle(ok ? okResult() : failure('internal', 'save did not complete'))
    },

    onCloseSaveRequest(handler: () => void): () => void {
      closeSaveHandlers.add(handler)
      return () => {
        closeSaveHandlers.delete(handler)
      }
    },

    sendCloseSaveResult(ok: boolean): void {
      hostSave?.settle(ok ? okResult() : failure('internal', 'save did not complete'))
    },

    onFileRenamed(handler: (path: string) => void): () => void {
      renameHandlers.add(handler)
      return () => {
        renameHandlers.delete(handler)
      }
    },

    onExportRequest(handler: (format: HostExport) => void): () => void {
      exportHandlers.add(handler)
      return () => {
        exportHandlers.delete(handler)
      }
    },

    onPrintRequest(handler: () => void): () => void {
      printHandlers.add(handler)
      return () => {
        printHandlers.delete(handler)
      }
    },

    async exportPdf(request: { html: string; suggestedName: string }): Promise<ExportResult> {
      if (typeof request?.html !== 'string' || !request.html) {
        hostPrint?.settle({ printed: false })
        return { ok: false, error: 'empty document' }
      }
      return printDocument(request.html, request.suggestedName)
    },

    async exportHtml(request: { html: string; suggestedName: string }): Promise<ExportResult> {
      if (typeof request?.html !== 'string') return { ok: false, error: 'empty document' }
      const name = `${(request.suggestedName || 'document').replace(/\.html?$/i, '')}.html`
      const html = await inlineAssets(request.html)
      downloadBlob(name, new Blob([encodeText(html)], { type: 'text/html;charset=utf-8' }))
      return { ok: true, path: name }
    },

    async exportDocxBytes(name: string, bytes: Uint8Array): Promise<ExportResult> {
      const file = `${(name || 'document').replace(/\.docx$/i, '')}.docx`
      downloadBlob(
        file,
        new Blob([bytes as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      )
      return { ok: true, path: file }
    },

    decodeBase64: base64ToBytes,

    async pickImage(): Promise<string | null> {
      const [file] = await pickFiles('image/png,image/jpeg,image/gif,.png,.jpg,.jpeg,.gif', false)
      if (!file) return null
      const ext = (file.name.split('.').pop() ?? '').toLowerCase()
      return assets.store(new Uint8Array(await file.arrayBuffer()), ext)
    },

    async saveImage(data: { base64: string; ext: string }): Promise<string | null> {
      if (!data || typeof data.base64 !== 'string') return null
      return assets.storeBase64(data.base64, String(data.ext ?? ''))
    },

    readImage: (src: string) => assets.read(src),

    /** web-only: display URL of a relative document picture (null = not mapped) */
    resolveAssetUrl: (src: string): string | null => assets.resolve(src),

    /** web-only: the authored path of a display URL (null = not one of ours) */
    unresolveAssetUrl: (url: string): string | null => assets.unresolve(url),

    getPathForFile: (): string => '',
  }
}

export type TextWebApi = ReturnType<typeof createTextWebApi>
