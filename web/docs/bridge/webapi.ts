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
 * | openDocx                  | null: picking another document is the host's file browser (no frame picker)      |
 * | saveDocx(path,data,auto)  | api.save {fileId, data, etag, auto}; 'conflict' -> reason 'external-modified'    |
 * | saveDocxAs                | api.saveAs {name, data, sourceFileId} (host dialog); 'cancelled' -> {ok:false}   |
 * | saveDocxNew               | api.saveAs {name, data, silent: true} (first save of an untitled document)       |
 * | getRecentFiles            | api.recents {limit} -> `uniwork://files/<id>/<name>` paths                        |
 * | exportPdf                 | api.export {format:'pdf', fileId, page size} -> download; failure -> window.print |
 * | printPdfBuffer / saveMergedPdf | deferred marker parts -> one exportPdf of the current file                  |
 * | exportHtml                | renderer-built HTML -> browser download (no server needed)                       |
 * | onCloseCheck & co, onMenuCommand | ./session.ts: `dirty` / `title` events, host `save` / `saveAs` requests   |
 * | projectApi.*              | ./project-memory.ts (AI-only; AI is hidden on the web)                           |
 * Every successful save emits `saved` {file, versionId, initiatedByFrame}.
 *
 * Host -> frame requests handled here: `open`, `save` (runs the editor's full
 * save flow), `saveAs` (runs the editor's Save As with the host's name),
 * `print` ({mode:'pdf'} = server export, else the in-frame print dialog).
 *
 * Not here on purpose: AI / search / image fetch (./ai.ts, stubbed + hidden),
 * attachments (./browser.ts keeps them in the browser; AI-panel only),
 * rename events / altChunk conversion / doc passwords (./hide.ts; the protocol
 * has no message for them yet). Encrypted (CFB) docx is passed through as-is.
 */
import type {
  DesktopApi,
  OpenDocxResult,
  OpenFileResult,
} from '../../../apps/docs/src/shared/ipc'
import type {
  FileMeta,
  FileSource,
  OpenPayload,
  ProtocolErrorShape,
  SaveResult,
} from '../protocol/types'
import { TIMEOUTS, errorCode, type FramePort } from './frame-port'
import { createSession, type SessionOptions } from './session'
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

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
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
}

// ---------------------------------------------------------------- factory

export function createWebApi(port: FramePort, opts: WebApiOptions = {}) {
  /** fileId -> latest server metadata (etag = If-Match base of the next save) */
  const files = new Map<string, FileMeta>()
  /** the document this frame shows (save / export target) */
  let current: string | null = null
  const session = createSession(port, opts.session)

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

  // ------------------------------------------------------------ save bookkeeping

  /** set while the host's `save` request runs the editor's save flow */
  let hostSave: { error: ProtocolErrorShape | null } | null = null
  /** set while the host's `saveAs` request waits for the editor's saveDocxAs */
  let hostSaveAs: { name?: string; settle: (r: SaveResult) => void } | null = null

  function landed(result: Extract<SaveResult, { ok: true }>): FileMeta {
    const file = { ...result.file }
    if (result.versionId && !file.versionId) file.versionId = result.versionId
    remember(file)
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
    .then((s) => (s.open ? toOpenResult(s.open) : openById(s.documentId)))
    .catch((err: unknown) => {
      console.error('[docs-web] initial open failed:', err)
      port.reportError(err, true)
      return null
    })

  function deliver(result: OpenFileResult): void {
    if (booted && openListeners.size > 0) for (const l of openListeners) l(result)
    else pendingOpen = Promise.resolve(result)
  }

  port.handleOpen(async (payload) => {
    const result = await toOpenResult(payload)
    deliver(result)
    return { opened: true, title: result.name }
  })

  port.handleSave(async () => {
    if (!current) return failure('not_ready', 'no document is open')
    if (hostSave) return failure('conflict', 'a save is already running')
    hostSave = { error: null }
    try {
      const ok = await session.runSave()
      const file = files.get(current)
      if (ok && file) {
        return { ok: true, file, ...(file.versionId ? { versionId: file.versionId } : {}) }
      }
      return { ok: false, error: hostSave.error ?? { code: 'internal', message: 'save did not complete' } }
    } finally {
      hostSave = null
    }
  })

  port.handleSaveAs(async (payload) => {
    if (hostSaveAs) return failure('conflict', 'a save-as is already running')
    return new Promise<SaveResult>((resolve) => {
      const timer = setTimeout(
        () => settle(failure('timeout', 'the editor did not start Save As')),
        TIMEOUTS.dialog,
      )
      const settle = (r: SaveResult) => {
        clearTimeout(timer)
        hostSaveAs = null
        resolve(r)
      }
      hostSaveAs = { ...(payload?.name ? { name: payload.name } : {}), settle }
      if (!session.runMenuCommand('save-as')) settle(failure('not_ready', 'no editor is listening'))
    })
  })

  // ------------------------------------------------------------ export / print

  function printViaBrowser(defaultName: string): { ok: boolean; path?: string } {
    window.print()
    return { ok: true, path: `${withExt(defaultName, '.pdf')} (browser print dialog)` }
  }

  /**
   * Server-rendered PDF of the current file's stored version (unsaved edits
   * are not in it); no file yet or any failure -> the in-frame print dialog.
   */
  async function exportCurrentPdf(
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    scale?: number,
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    const fileId = current
    if (!fileId) return printViaBrowser(defaultName)
    const name = withExt(defaultName || files.get(fileId)?.name || 'document', '.pdf')
    try {
      const out = await port.request(
        'api.export',
        {
          format: 'pdf',
          fileId,
          name,
          ...(pageWidthTwips > 0 ? { pageWidthTwips } : {}),
          ...(pageHeightTwips > 0 ? { pageHeightTwips } : {}),
          scale: scale ?? 1,
        },
        { timeoutMs: TIMEOUTS.transfer },
      )
      downloadBlob(out.name || name, new Blob([out.data], { type: out.mimeType || 'application/pdf' }))
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
    window.print()
    return { printed: true }
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

    async openDocx(): Promise<OpenDocxResult> {
      return null
    },

    async openDocxPath(path: string): Promise<OpenDocxResult> {
      const fileId = idFromPath(path)
      if (!fileId) return null
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
      const fileId = idFromPath(path)
      if (!fileId) return { ok: false, error: `not a UniWork document: ${basename(String(path))}` }
      const etag = files.get(fileId)?.etag
      const payload = { fileId, data: copyBuffer(data), ...(etag ? { etag } : {}), auto: auto === true }
      const res = await sendSave('api.save', () =>
        port.request('api.save', payload, { timeoutMs: TIMEOUTS.transfer, transfer: [payload.data] }),
      )
      if (res.ok) {
        landed(res)
        return { ok: true }
      }
      if (hostSave) hostSave.error = res.error
      // the host owns the conflict UI (reload / keep mine); the editor stays dirty
      if (res.error.code === 'conflict') {
        return { ok: false, reason: 'external-modified', error: res.error.message }
      }
      return { ok: false, error: res.error.code === 'timeout' ? 'save timed out' : res.error.message }
    },

    async saveDocxAs(defaultName: string, data: ArrayBuffer, sourcePath?: string | null) {
      const pending = hostSaveAs
      const sourceFileId = idFromPath(sourcePath)
      const payload = {
        name: withExt(pending?.name || defaultName || 'Untitled', '.docx'),
        data: copyBuffer(data),
        ...(sourceFileId ? { sourceFileId } : {}),
      }
      const res = await sendSave('api.saveAs', () =>
        port.request('api.saveAs', payload, { timeoutMs: TIMEOUTS.dialog, transfer: [payload.data] }),
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
      const payload = { name: withExt(defaultName || 'Untitled', '.docx'), data: copyBuffer(data), silent: true }
      const res = await sendSave('api.saveAs', () =>
        port.request('api.saveAs', payload, { timeoutMs: TIMEOUTS.transfer, transfer: [payload.data] }),
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
          ? res.files.filter((f) => typeof f?.fileId === 'string' && typeof f.name === 'string').map(pathFor)
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
  } satisfies Partial<DesktopApi>

  // install.ts merges this into window.desktop and assigns `.projectApi` to window.projectApi
  return Object.assign(desktopPart, { projectApi })
}

export type WebApi = ReturnType<typeof createWebApi>
