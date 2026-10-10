/**
 * Headless entry (UNI-1013, GO-B2/B3 follow-up): a top-level page that opens one
 * same-origin document without a protocol host, for the server-side PDF export
 * (dev-uniwork apps/office-engine/src/worker/docs-pdf.ts: headless Chromium,
 * Page.printToPDF on the top-level page). Contract: web/docs/protocol/README.md
 * "Headless entry".
 *
 *   index.html?headless=1&open=<same-origin path>
 *
 * Active only when ALL hold, otherwise the page is the normal framed editor and
 * `?open=` is ignored:
 *   - the page is top-level (window.parent === window): a framed page (UniWork)
 *     never enters it, whatever its URL says;
 *   - `headless=1` is present (explicit opt-in);
 *   - `open` resolves to an http(s) URL of the page's own origin: absolute
 *     cross-origin, protocol-relative (`//x`, `/\x`), data:, blob:, javascript:
 *     and URLs with credentials are rejected.
 *
 * In that mode there is no postMessage handshake: `createHeadlessPort` stands in
 * for the frame client, `whenInitialized()` resolves at once (so the 3 s host
 * appearance wait never blocks) with the document as `init.open` (fetched with
 * credentials: 'omit'), theme forced light and print/export-only capabilities.
 * Every `api.*` request is refused (`unsupported`) and the bridge refuses saves.
 * The renderer's headless-export path runs as on desktop: consumeHeadlessExport
 * hands it a target, it waits for the opened document's pagination to settle,
 * then calls exportPdf / printPdfBuffer + saveMergedPdf and headlessExportDone.
 * The engine's page shim replaces those calls with Page.printToPDF; without a
 * shim they print nothing and report ok, so the readiness signal still fires.
 *
 * Readiness signal: `window.__docsWebHeadless` {state, error?, prints} mirrored
 * to `<html data-docs-headless="state">` and a `docs-web:headless` window event
 * (detail = the same object). state: 'opening' -> 'opened' (bytes handed to the
 * renderer) -> 'done' (renderer's headlessExportDone ok) | 'failed' (+ error).
 */
import type { DesktopApi, OpenDocxResult } from '../../../apps/docs/src/shared/ipc'
import { DocsProtocolError, type Capabilities } from '../protocol/types'
import type { FramePort, PortSession } from './frame-port'

export const HEADLESS_PARAM = 'headless'
export const HEADLESS_OPEN_PARAM = 'open'
/** file id of the headless document (paths are `uniwork://files/headless/<name>`) */
export const HEADLESS_FILE_ID = 'headless'
/** what consumeHeadlessExport hands the renderer (the engine shim answers its own) */
export const HEADLESS_OUT_PATH = 'headless:output.pdf'

/** read-only: print / PDF export only, no save / save-as / recents / picker */
export const HEADLESS_CAPABILITIES: Readonly<Capabilities> = Object.freeze({
  save: false,
  saveAs: false,
  recents: false,
  filePick: false,
  print: true,
  exportPdf: true,
  exportHtml: false,
  attachments: false,
  images: false,
  ai: false,
})

export interface HeadlessEntry {
  /** absolute, same-origin document URL */
  url: string
  /** display name (last path segment, decoded) */
  name: string
}

/** not framed; a parent we cannot read counts as framed (fail closed) */
export function isTopLevel(win: Window): boolean {
  try {
    return win.parent === win && win.top === win
  } catch {
    return false
  }
}

function documentName(pathname: string): string {
  const last = pathname.split('/').pop() ?? ''
  try {
    return decodeURIComponent(last) || 'document.docx'
  } catch {
    return last || 'document.docx'
  }
}

/**
 * The gate. `href` is the page URL; `topLevel` comes from isTopLevel(window).
 * Returns null (normal framed editor) unless every condition above holds.
 */
export function parseHeadlessEntry(href: string, topLevel: boolean): HeadlessEntry | null {
  if (!topLevel) return null
  let page: URL
  try {
    page = new URL(href)
  } catch {
    return null
  }
  if (page.protocol !== 'http:' && page.protocol !== 'https:') return null
  if (page.searchParams.get(HEADLESS_PARAM) !== '1') return null
  const raw = page.searchParams.get(HEADLESS_OPEN_PARAM)?.trim()
  if (!raw) return null
  // protocol-relative (`//host`, `/\host`, `\\host`): another origin by construction
  if (/^[\\/]{2}/.test(raw)) return null
  let target: URL
  try {
    target = new URL(raw, page)
  } catch {
    return null
  }
  // blob:http://same-origin/... has the page's origin: the scheme check rejects it
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
  if (target.origin !== page.origin) return null
  if (target.username || target.password) return null
  return { url: target.href, name: documentName(target.pathname) }
}

// ---------------------------------------------------------------- readiness signal

export type HeadlessState = 'opening' | 'opened' | 'done' | 'failed'

/** one print the renderer asked for (exportPdf = 'print', printPdfBuffer = 'part') */
export interface HeadlessPrint {
  kind: 'print' | 'part' | 'merge'
  w?: number
  h?: number
  scale?: number
}

export interface HeadlessStatus {
  state: HeadlessState
  error?: string
  prints: HeadlessPrint[]
}

export const HEADLESS_EVENT = 'docs-web:headless'

function createStatus() {
  const status: HeadlessStatus = { state: 'opening', prints: [] }
  const publish = () => {
    ;(window as unknown as { __docsWebHeadless: HeadlessStatus }).__docsWebHeadless = status
    document.documentElement.dataset.docsHeadless = status.state
    window.dispatchEvent(new CustomEvent(HEADLESS_EVENT, { detail: { ...status } }))
  }
  publish()
  return {
    status,
    set(state: HeadlessState, error?: string): void {
      // 'failed' is final: a later report must not turn it back into success
      if (status.state === 'failed') return
      status.state = state
      if (error) status.error = error
      publish()
    },
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------- port

/** the frame client's stand-in: no postMessage, `init` is synthesized from the entry */
export function createHeadlessPort(
  entry: HeadlessEntry,
  onError?: (error: unknown) => void,
): FramePort {
  const session: PortSession = {
    documentId: HEADLESS_FILE_ID,
    open: {
      file: { fileId: HEADLESS_FILE_ID, name: entry.name },
      source: { kind: 'url', url: entry.url },
    },
    theme: 'light',
    capabilities: { ...HEADLESS_CAPABILITIES },
  }
  const none = () => () => {}
  return {
    whenInitialized: () => Promise.resolve(session),
    request: (type) =>
      Promise.reject(
        new DocsProtocolError({
          code: 'unsupported',
          message: `${type} is not available on the headless entry`,
        }),
      ),
    handleOpen: none,
    handleSave: none,
    handleSaveAs: none,
    handlePrint: none,
    handleCloseCheck: none,
    onFileRenamed: none,
    onTheme: none,
    onLanguage: none,
    setDirty: () => {},
    setTitle: () => {},
    reportSaved: () => {},
    reportError: (error) => onError?.(error),
  }
}

// ---------------------------------------------------------------- DesktopApi part

const READ_ONLY = 'read-only headless page'

/** printPdfBuffer's part marker without a shim (truthy: the renderer bisects on an empty part) */
export const HEADLESS_PART = 'headless-part'

/**
 * The headless port plus `desktopFor(webapi)`: overrides merged into window.desktop
 * after every other module. Its consumePendingOpenDocx wraps webapi's (which reads
 * the synthesized init.open).
 */
export function createHeadless(entry: HeadlessEntry) {
  const signal = createStatus()
  const port = createHeadlessPort(entry, (err) => signal.set('failed', describe(err)))
  let exportClaimed = false
  const printed = (job: HeadlessPrint) => {
    signal.status.prints.push(job)
    return { ok: true, path: HEADLESS_OUT_PATH }
  }

  const desktopFor = (webapi: { consumePendingOpenDocx(): Promise<OpenDocxResult> }) =>
    ({
      async consumePendingOpenDocx(): Promise<OpenDocxResult> {
        const result = await webapi.consumePendingOpenDocx()
        if (result) signal.set('opened')
        else signal.set('failed', 'the document did not open')
        return result
      },
      async consumeHeadlessExport() {
        if (exportClaimed) return null
        exportClaimed = true
        return { outPath: HEADLESS_OUT_PATH, format: 'pdf' as const }
      },
      headlessExportDone(report: { ok: boolean; error?: string }): void {
        if (report?.ok === true) signal.set('done')
        else signal.set('failed', report?.error ?? 'export failed')
      },
      // no engine shim: nothing to print into; the page stays loaded for the driver
      async exportPdf(_name: string, w: number, h: number, _out?: string, scale?: number) {
        return printed({ kind: 'print', w, h, scale })
      },
      async printPdfBuffer(w: number, h: number, scale?: number) {
        printed({ kind: 'part', w, h, scale })
        return { ok: true, base64: HEADLESS_PART }
      },
      async saveMergedPdf(_name: string, _parts: string[], _out?: string) {
        return printed({ kind: 'merge' })
      },
      async saveDocx() {
        return { ok: false, error: READ_ONLY }
      },
      async saveDocxAs() {
        return { ok: false, error: READ_ONLY }
      },
      async saveDocxNew() {
        return { ok: false, error: READ_ONLY }
      },
    }) satisfies Partial<DesktopApi>

  return { port, desktopFor, status: signal.status }
}
