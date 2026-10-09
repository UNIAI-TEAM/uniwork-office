/**
 * The Sheets engine seam (UNI-1016, GO-D3 = C / CONTRACT C11).
 *
 * On the desktop every workbook operation goes renderer -> IPC -> Electron main (session map,
 * snapshot, save planner) -> the native xlsx-sidecar. On the web the same renderer-facing
 * session API sits behind ONE typed interface, `SheetsEngineTransport`, so the bridge
 * (../bridge.ts) never knows which backend runs it:
 *   - `createUnavailableTransport()` (./unavailable.ts): the stub this lane ships. Every call
 *     rejects with `EngineUnavailableError`; the renderer shows the styled
 *     "cannot be opened on the web yet" screen.
 *   - the WASM backend (follow-up SH2): xlsx-engine compiled to wasm32-wasip1 in a module Web
 *     Worker of the frame, plus the main-process session/save logic ported into the frame.
 *   - a host proxy (option B, not chosen) would implement the same interface over protocol
 *     requests.
 * Measurements and the decision: docs/web-modules/sheets-sidecar.md.
 *
 * Method shapes are the renderer's own request/result types (apps/sheets/src/shared/
 * desktop-api.ts), so the bridge forwards `window.desktopApi.*` calls unchanged. What changes
 * between desktop and web is only where the bytes come from: the host hands the frame bytes
 * (`api.open`) and takes bytes back (`api.save`), so `open` and `serialize` are byte-based
 * instead of path-based.
 */
import type {
  WorkbookFile,
  WorkbookFormulaCellsRequest,
  WorkbookFormulaCellsResult,
  WorkbookMediaRequest,
  WorkbookMediaResult,
  WorkbookPivotDefinition,
  WorkbookPivotRequest,
  WorkbookRangeRequest,
  WorkbookRangeResult,
  WorkbookRecalcRequest,
  WorkbookRecalcResult,
  WorkbookSaveRequest,
} from '../../../../apps/sheets/src/shared/desktop-api'
import { ENGINE_UNAVAILABLE } from '../../../../apps/sheets/src/renderer/web-engine'

export { ENGINE_UNAVAILABLE }

export type EngineKind = 'unavailable' | 'wasm' | 'host'

/**
 * Operations beyond the core a backend supports. They feed the sidecar-only capability keys
 * (../capabilities.ts): a missing feature hides its UI entry. C11 keeps recalcFallback and
 * mergeWorkbooks hidden on the web even when a backend could run them.
 */
export interface EngineFeatures {
  /** `.xls` -> `.xlsx` before open (sidecar `convert_workbook`, calamine) */
  xlsImport: boolean
  /** pivot definitions for PivotTable refresh (sidecar `read_entries` x2 + TS parse) */
  pivotRefresh: boolean
  /** IronCalc recalc fallback for streamed workbooks (sidecar `recalc_cells`) */
  recalcFallback: boolean
}

export const NO_ENGINE_FEATURES: Readonly<EngineFeatures> = Object.freeze({
  xlsImport: false,
  pivotRefresh: false,
  recalcFallback: false,
})

export interface EngineOpenInput {
  /** the document's name (extension decides xlsx / xlsm / xls) */
  name: string
  /** the workbook bytes from the host (`api.open` / `init.open` / `file.pick`) */
  data: ArrayBuffer
  /** UI language for number/date display (sidecar `open.locale`) */
  locale: string
  /** short date pattern of the user's locale, when known (sidecar `open.shortDateFormat`) */
  shortDateFormat?: string
}

export interface EngineSerializeResult {
  /** the saved workbook bytes, ready for `api.save` / `api.saveAs` */
  data: ArrayBuffer
  /** package parts the save rewrote (WorkbookSaveResult.touchedEntries) */
  touchedEntries: string[]
}

/**
 * The renderer-facing session API. A session (`sessionId`) is a workbook the engine holds and
 * streams cells from; sessions live until `close` (or `replaceSession`).
 */
export interface SheetsEngineTransport {
  readonly kind: EngineKind
  readonly features: Readonly<EngineFeatures>

  /** open a workbook from bytes; the result carries the new `sessionId` */
  open(input: EngineOpenInput): Promise<WorkbookFile>
  /** sidecar `read_range` */
  readRange(request: WorkbookRangeRequest): Promise<WorkbookRangeResult>
  /** sidecar `read_formula_cells` */
  readFormulaCells(request: WorkbookFormulaCellsRequest): Promise<WorkbookFormulaCellsResult>
  /** sidecar `read_media` (pictures; header/footer pictures for print) */
  readMedia(request: WorkbookMediaRequest): Promise<WorkbookMediaResult>
  /** sidecar `read_entries` + pivot parse (only when `features.pivotRefresh`) */
  readPivotDefinition(request: WorkbookPivotRequest): Promise<WorkbookPivotDefinition>
  /** sidecar `recalc_cells` on the session's bytes (only when `features.recalcFallback`) */
  recalc(request: WorkbookRecalcRequest): Promise<WorkbookRecalcResult>
  /**
   * Upstream desktop session commands this renderer version does not call yet (sidecar
   * `find_cells` / `read_row_outline`); optional so a backend can add them without a seam change.
   */
  findCells?(request: Readonly<Record<string, unknown>> & { sessionId: string }): Promise<unknown>
  readRowOutline?(request: { sessionId: string; sheetId: string }): Promise<unknown>
  /**
   * The workbook with the request's edits applied, as bytes (gateway planner + sidecar archive
   * commands). Pure: the session keeps streaming the pre-save bytes until `replaceSession`.
   */
  serialize(request: WorkbookSaveRequest): Promise<EngineSerializeResult>
  /**
   * After the host accepted the bytes: close `sessionId` and open a fresh session over `data`
   * (the desktop "session swap" after every save), returning the renderer's new WorkbookFile.
   */
  replaceSession(input: { sessionId: string } & EngineOpenInput): Promise<WorkbookFile>
  /** sidecar `close` (idempotent) */
  close(sessionId: string): Promise<void>
  /** release the backend (Worker, memory) when the frame goes away */
  dispose?(): void
}

/** the typed failure every operation of an unavailable engine answers */
export class EngineUnavailableError extends Error {
  readonly code = ENGINE_UNAVAILABLE
  constructor(readonly operation: string) {
    super(`${ENGINE_UNAVAILABLE}: the workbook engine is not available on the web (${operation})`)
    this.name = 'EngineUnavailableError'
  }
}

/** true for EngineUnavailableError and anything that carries its code (e.g. across a Worker) */
export function isEngineUnavailable(error: unknown): boolean {
  if (error instanceof EngineUnavailableError) return true
  const code = (error as { code?: unknown } | null)?.code
  if (code === ENGINE_UNAVAILABLE) return true
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.startsWith(`${ENGINE_UNAVAILABLE}:`)
}
