import { z } from 'zod'
import type { AgentToolCall, AgentToolDef } from '@genoffice/agent-core'
import {
  copyTargetBounds,
  describeOperationErrors,
  workbookOperationSchema,
  type WorkbookOperation,
} from '@genoffice/xlsx-gateway/domain/workbook-dsl'
import {
  columnLabel,
  parseAddress,
  parseRange,
  rangeCellCount,
  formatAddress,
  type RangeBounds,
} from '@genoffice/xlsx-gateway/domain/cell-address'
import type {
  ApplyOutcome,
  CellFormatState,
  CellScalar,
  ChangePlan,
} from '@genoffice/xlsx-gateway/domain/workbook.types'
import { cap } from '../capabilities'
import { t } from '../i18n/locale'
import { formatRangeAggregate, type RangeAggregate } from './aggregate'
import type { CellRead } from './cell-read'
import type { RangeRowsOutcome } from './range-rows'
import { reconcileRows, type ReconcileResult, type ReconcileSideResult } from './reconcile'
import {
  CRITERION_OPS,
  summarizeRows,
  type Criterion,
  type CriterionOp,
  type SummarizeFunction,
  type SummarizeResult,
} from './summarize'
import { guideCatalogSummary, loadGuides } from './guides'

/**
 * The workbook DSL as an AgentSkill tool set: read-only context/reader tools
 * and one propose tool. Mirrors the docx skill's read-before-write discipline
 * (get_document_context / read_blocks / replace_blocks), but the mutating
 * tool never touches the workbook directly — it only computes a ChangePlan
 * and hands it to the SAME plan/apply path the manual flow uses, which now
 * auto-applies immediately (undo via ⌘Z / inline button covers everything;
 * the preview card only remains as a manual fallback when apply fails).
 */

/** raw shape the model sends for one operation; validated against workbookOperationSchema */
export type ProposedOperation = Record<string, unknown>

export interface SheetRef {
  readonly id: string
  readonly name: string
  /** Data extent (from the xlsx dimension or known cells); may drift slightly
   * after structural changes within the session */
  readonly rows?: number
  readonly columns?: number
  /** Worksheet XML above the gateway save-patch cap: readable, never editable. */
  readonly readOnlyOversized?: boolean
}

export interface ChartRef {
  readonly path: string
  readonly title: string
  readonly types: string
  readonly sheetId: string
}

/**
 * The user's selection captured when they sent the message. The grid selection
 * is live: users keep clicking around while the AI works, so reading it at
 * tool-call time would silently retarget "this column" mid-run.
 */
export interface FrozenSelection {
  /** A1 notation on the sheet it was taken from, clamped to the data extent so
   *  a whole-column click is not reported as a million rows */
  readonly a1: string
  readonly sheetId: string
  /** header names when the selection covers whole columns */
  readonly columns?: readonly string[]
}

export interface ActiveSheetInfo {
  readonly mode: 'demo' | 'lazy' | 'none'
  /** lazy mode only: the file is too large for a full load — cached values
   * stream in per viewport, and the live formula engine never sees the whole
   * data (formula writes over the file's sheets are gated) */
  readonly streaming?: boolean | undefined
  readonly sheetId: string
  readonly sheetName: string
  /** demo mode only: current revision, needed for the CAS-checked plan() call */
  readonly revision?: number
  /** non-empty cell addresses known to the caller without an extra read */
  readonly knownAddresses: readonly string[]
  /** lazy mode only: the viewport-backed range currently present in Univer */
  readonly loadedRange?: string | undefined
  /** every sheet in the workbook, active one included */
  readonly sheets: readonly SheetRef[]
  /** the selection to interpret "this column / these rows" against, in A1
   * notation (sheet-qualified when it is not the active sheet) */
  readonly selection?: string | undefined
  /** the selection above is the send-time snapshot rather than a live read */
  readonly selectionFrozen?: boolean | undefined
  /** header names of the columns the selection covers, when it covers whole
   * ones — what the user means by "this column" */
  readonly selectionColumns?: readonly string[] | undefined
  /** merged ranges on the active sheet (A1 notation) */
  readonly merges?: readonly string[] | undefined
  /** charts in the workbook (imported files only) */
  readonly charts?: readonly ChartRef[] | undefined
}

export interface FindCellsOptions {
  /** empty only when errorsOnly is set */
  readonly query: string
  readonly regex: boolean
  readonly lookIn: 'values' | 'formulas' | 'both'
  readonly errorsOnly: boolean
  readonly sheetId?: string | undefined
  readonly maxResults: number
}

export interface FindCellsMatch {
  readonly sheetName: string
  readonly address: string
  readonly value: CellScalar
  readonly formula?: string | undefined
}

export interface FindCellsOutcome {
  readonly matches: readonly FindCellsMatch[]
  /** the scan stopped at maxResults or the scan budget; more matches may exist */
  readonly truncated: boolean
  /** sheets whose background indexing hasn't finished — results there may be partial */
  readonly incompleteSheets: readonly string[]
  readonly error?: string
}

export interface SelectRangeOutcome {
  readonly ok: boolean
  readonly sheetName?: string
  readonly error?: string
}

export interface TraceCellSample {
  readonly address: string
  readonly value: CellScalar
  readonly formula?: string | undefined
}

export interface TraceRefInfo {
  /** display label like "B2:B9" or "Data!A1" */
  readonly label: string
  readonly cellCount: number
  readonly samples: readonly TraceCellSample[]
  /** some sampled value is a formula error (#REF!, #DIV/0!, …) */
  readonly hasError: boolean
  /** qualifier didn't match any sheet — external workbook or unresolvable */
  readonly external?: boolean
}

export interface TracePrecedentsOutcome {
  readonly formula?: string | undefined
  readonly value?: CellScalar
  readonly refs: readonly TraceRefInfo[]
  /** the formula had more references than the tracer reports */
  readonly truncatedRefs?: boolean
  /** formula also uses defined names / identifiers the tracer cannot resolve */
  readonly usesNames?: boolean
  readonly error?: string
}

export interface TraceDependentInfo {
  readonly sheetName: string
  readonly address: string
  readonly formula: string
  readonly value: CellScalar
}

export interface TraceDependentsOutcome {
  readonly dependents: readonly TraceDependentInfo[]
  readonly truncated: boolean
  readonly incompleteSheets: readonly string[]
  readonly error?: string
}

/** every file type create_document can produce */
export type CreateDocumentFileType = 'xlsx' | 'csv' | 'docx' | 'pdf' | 'md' | 'html'

/** create_document request handed to the App: xlsx/csv name a worksheet to
 * export; docx/pdf/md/html carry AI-authored content (routed to the docs flow).
 * Members keep singleton discriminants so the type narrows properly. */
export type CreateDocumentToolRequest =
  | { type: 'xlsx'; sheetId?: string | undefined; title?: string | undefined }
  | { type: 'csv'; sheetId?: string | undefined; title?: string | undefined }
  | { type: 'docx'; title: string; content: string }
  | { type: 'pdf'; title: string; content: string }
  | { type: 'md'; title: string; content: string }
  | { type: 'html'; title: string; content: string }

export type CreateDocumentToolOutcome =
  | {
      ok: true
      /** final file name including extension (title may default to the sheet name) */
      name: string
      /** absolute path when the file was written directly (docx opens a tab that saves itself) */
      path?: string
      /** xlsx/csv: the exported worksheet's name */
      sheetName?: string
      /** xlsx/csv: the sheet holds formulas — the file keeps computed values only */
      hadFormulas?: boolean
    }
  | { ok: false; error: string }

export interface SheetsSkillDeps {
  getActiveSheetInfo(): ActiveSheetInfo
  /** Ensure a lazy workbook range is present in Univer before reading it. */
  ensureRangeLoaded?(range: RangeBounds, sheetId?: string): boolean | Promise<boolean>
  /** cell values/formulas; reads the active sheet unless sheetId targets another */
  readCells(addresses: readonly string[], sheetId?: string): Record<string, CellRead>
  /** per-cell explicit formatting; cells with no explicit format are omitted */
  readFormats(addresses: readonly string[], sheetId?: string): Record<string, CellFormatState>
  /** formatted report of a sheet's feature state (filters, CF, DV, names, visuals, …) */
  readSheetFeatures(sheetId?: string): string
  /** workbook-wide value/formula search (ai/workbook-search.ts) */
  findCells(options: FindCellsOptions): FindCellsOutcome | Promise<FindCellsOutcome>
  /** activate a sheet, select a range, and scroll it into view */
  selectRange(
    sheetId: string | undefined,
    bounds: RangeBounds,
  ): SelectRangeOutcome | Promise<SelectRangeOutcome>
  /** formula audit: what a formula reads (ai/formula-audit.ts) */
  tracePrecedents(
    sheetId: string | undefined,
    address: string,
  ): TracePrecedentsOutcome | Promise<TracePrecedentsOutcome>
  /** formula audit: which formulas read a cell (ai/formula-audit.ts) */
  traceDependents(
    sheetId: string | undefined,
    address: string,
  ): TraceDependentsOutcome | Promise<TraceDependentsOutcome>
  /** Batched statistics over a large range (lazy mode streams it through the
   * sidecar without loading the grid) — the supported path for distinct
   * counts / frequency questions that must never become COUNTIF formulas. */
  aggregateRange?(
    sheetId: string | undefined,
    range: RangeBounds,
    options?: { hiddenRows: 'include' | 'skip' },
  ): Promise<
    | {
        ok: true
        aggregate: RangeAggregate
        /** hidden/filtered rows inside the range (included or skipped per options) */
        hiddenRows?: number
        /** formula cells whose counted value is the file's cached result */
        cachedFormulaCells?: number
        /** cached formula values counted while inputs were edited this session */
        staleCache?: boolean
      }
    | { ok: false; error: string }
  >
  /** Every row of a range with hidden flags and per-cell cached-formula flags
   * (ai/range-rows.ts) — the input of summarize_range. */
  collectRows?(sheetId: string | undefined, range: RangeBounds): Promise<RangeRowsOutcome>
  /** Hidden/filtered rows inside the range, ascending; read_range marks them. */
  hiddenRows?(
    sheetId: string | undefined,
    range: RangeBounds,
  ): readonly { row: number; reason: 'hidden' | 'filtered' }[]
  /** `applied` resolves with the real apply result (the lazy path applies async);
   * the tool awaits it so the model never hears "applied" for a batch that failed */
  proposeOperations(
    operations: readonly WorkbookOperation[],
    summary: string,
  ): { ok: true; plan: ChangePlan; applied?: Promise<ApplyOutcome> } | { ok: false; error: string }
  /** AI create_document: write a new standalone file (xlsx/csv from a
   * worksheet; docx/pdf/md from content) into the default save folder and
   * open it in a new tab (ai/create-document.ts). */
  createDocument?(request: CreateDocumentToolRequest): Promise<CreateDocumentToolOutcome>
}

const MAX_READ_ADDRESSES = 100
/** Max cells per streamed block; the App's ensureRangeLoaded enforces it too. */
export const MAX_READ_RANGE_CELLS = 2000
const MAX_AGGREGATE_CELLS = 1_000_000
const MAX_AGGREGATE_TOP_VALUES = 50
const DEFAULT_AGGREGATE_TOP_VALUES = 10
/** Read-back after write: max number of formula cells whose results are read back */
const MAX_READBACK_FORMULAS = 10
/** Read-back after write: wait time (ms) for Univer's async formula recalc */
const FORMULA_RECALC_DELAY_MS = 300
const MAX_READ_FORMAT_CELLS = 200
const MAX_FIND_RESULTS = 200
const DEFAULT_FIND_RESULTS = 50

export const WORKBOOK_TOOLS: AgentToolDef[] = [
  {
    name: 'get_workbook_context',
    description:
      'Get a workbook overview: all sheets (id/name/data-extent rows-columns), active sheet, current selection, known non-empty cell addresses. ' +
      'For data-size questions (how many rows / how much data), answer from the data extent here instead of reading block by block; use read_range or read_cells when concrete values are needed.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'read_range',
    description:
      'Read current values/formulas by rectangular range, returning a grid with row numbers and column letters. ' +
      'The requested range is not the worksheet data extent: never infer total row or record count from its ending row; use get_workbook_context. ' +
      'This is the preferred way to read data; max 2000 cells — read larger regions in multiple calls. ' +
      'The grid shows the text as displayed; cells whose stored value differs (percent, currency, date, numbers with a format, numeric-looking text) ' +
      'are listed under it as [type; raw value; number format], e.g. "B2: percent; raw 0.1; format 0%" — calculate with the raw value (dates are serial numbers). ' +
      'Hidden/filtered rows are labelled in the grid.',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          description: 'Range like "A1:D20"; a single cell like "B2" is also accepted',
        },
        sheetId: {
          type: 'string',
          description:
            'Sheet to read from (id from get_workbook_context); reads the active sheet when omitted',
        },
      },
      required: ['range'],
    },
  },
  {
    name: 'aggregate_range',
    description:
      'Compute statistics for a range without reading or modifying it cell by cell: non-empty count, distinct-value count, ' +
      'numeric sum/average/min/max, and the most frequent values. Handles very large ranges (up to 1,000,000 cells) efficiently. ' +
      'ALWAYS use this for questions like "how many distinct suppliers/customers", value distributions, or column totals on large sheets — ' +
      'never loop read_range over big data and never write COUNTIF/SUMPRODUCT distinct-count formulas (they are rejected as too expensive). ' +
      'Aggregate one column at a time for meaningful distinct counts.',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          description: 'Range like "D2:D88588" (typically one column, excluding the header)',
        },
        sheetId: {
          type: 'string',
          description: 'Target sheet id; the active sheet when omitted',
        },
        topValues: {
          type: 'number',
          description: 'How many most-frequent values to return (0-50, default 10)',
        },
        skipHiddenRows: {
          type: 'boolean',
          description:
            'Leave out hidden/filtered rows (visible rows only, like SUBTOTAL). Default false: they are included, like SUM. The result always states how many there were and whether they were included — repeat that in your answer.',
        },
      },
      required: ['range'],
    },
  },
  {
    name: 'summarize_range',
    description:
      'Read-only conditional statistics over a table range, computed by code: sum / count / average / min / max of one column, ' +
      'optionally filtered by conditions on other columns (all must hold, like SUMIFS/COUNTIFS) and grouped by a column (like a pivot). ' +
      'Use it for "total revenue for Hà Nội", "count of orders per region", "average price where qty > 10" — instead of writing COUNTIFS/SUMIFS helper cells or adding numbers yourself. ' +
      'Columns are Excel column letters of the sheet (read the header row first to map names like X/Y/Z to letters). ' +
      'Only real numbers are summed: text such as "1.234,5", blanks, booleans and errors are skipped and counted by reason, never converted. ' +
      'Text conditions match case-insensitively; >, >=, <, <= compare numbers only (dates are serial numbers). ' +
      'The result reports the range, the filter, rows processed/matching, hidden/filtered rows and every skipped cell — state these in your answer. Up to 1,000,000 cells.',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          description:
            'The table, e.g. "A1:F5000"; its first row is the header unless hasHeader=false',
        },
        sheetId: {
          type: 'string',
          description: 'Target sheet id (from get_workbook_context); the active sheet when omitted',
        },
        function: {
          type: 'string',
          enum: ['sum', 'count', 'average', 'min', 'max'],
          description:
            'sum/average/min/max of valueColumn, or count of matching rows (default: sum when valueColumn is given, else count)',
        },
        valueColumn: {
          type: 'string',
          description:
            'Column letter whose numbers are aggregated, e.g. "E" (required except for count)',
        },
        where: {
          type: 'array',
          description: 'Conditions that must all hold',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string', description: 'Column letter, e.g. "C"' },
              op: { type: 'string', enum: [...CRITERION_OPS] },
              value: {
                type: 'string',
                description:
                  'Comparison value (omit for blank / not_blank); numeric text like "100" compares as a number',
              },
            },
            required: ['column', 'op'],
          },
        },
        groupBy: {
          type: 'string',
          description: 'Column letter to group by; each distinct value gets its own result',
        },
        hasHeader: {
          type: 'boolean',
          description: 'The first row of range is a header row (default true)',
        },
        skipHiddenRows: {
          type: 'boolean',
          description:
            'Leave out hidden/filtered rows (visible rows only). Default false: they are included; the result says how many there were.',
        },
        includeTotalRows: {
          type: 'boolean',
          description:
            'Count rows detected as totals/subtotals (SUBTOTAL formulas, a SUM over the block above, labels like "Total" / "Tổng cộng"). Default false: they are left out so nothing is counted twice; the result lists them.',
        },
        maxGroups: {
          type: 'number',
          description: 'How many groups to list, largest result first (1-200, default 50)',
        },
      },
      required: ['range'],
    },
  },
  {
    name: 'compare_ranges',
    description:
      'Read-only reconciliation of two ranges (two sheets, or a ledger vs a bank export), computed by code: rows are matched on a key column (trimmed, case-insensitive), ' +
      'and the result lists keys found only on the left, only on the right, and matched keys whose compared values differ (with right − left for numbers). ' +
      'Compared columns pair by identical header text unless leftColumns/rightColumns give explicit pairs. A number and the same digits stored as text count as different, never cast. ' +
      'Coverage is always reported: rows processed per side, blank and duplicate keys, hidden rows, and total/subtotal rows (left out by default). Use it instead of reading both ranges and comparing them yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        leftRange: {
          type: 'string',
          description:
            'First table, e.g. "A1:F500" (header in the first row unless hasHeader=false)',
        },
        leftSheetId: {
          type: 'string',
          description:
            'Sheet of leftRange (id from get_workbook_context); the active sheet when omitted',
        },
        leftKey: { type: 'string', description: 'Key column letter in leftRange, e.g. "A"' },
        leftColumns: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Column letters to compare on the left, paired by position with rightColumns',
        },
        rightRange: { type: 'string', description: 'Second table, e.g. "A1:D480"' },
        rightSheetId: {
          type: 'string',
          description: 'Sheet of rightRange; the active sheet when omitted',
        },
        rightKey: { type: 'string', description: 'Key column letter in rightRange' },
        rightColumns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Column letters to compare on the right, same count as leftColumns',
        },
        hasHeader: {
          type: 'boolean',
          description: 'Both ranges start with a header row (default true)',
        },
        tolerance: {
          type: 'number',
          description:
            'Numbers whose absolute difference is at most this compare equal (default 0)',
        },
        skipHiddenRows: {
          type: 'boolean',
          description:
            'Leave out hidden/filtered rows on both sides (default false: included and counted)',
        },
        includeTotalRows: {
          type: 'boolean',
          description:
            'Also match rows detected as totals/subtotals (default false: left out and listed)',
        },
        maxListed: {
          type: 'number',
          description:
            'How many missing keys and differences to list per section (1-200, default 50)',
        },
      },
      required: ['leftRange', 'leftKey', 'rightRange', 'rightKey'],
    },
  },
  {
    name: 'load_guide',
    description:
      'Load operation guide documents into context (field definitions, conventions, common mistakes). Except for the most basic single-cell reads/writes, load the relevant guides before generating propose_operations; several can be loaded at once. ' +
      `Available guides: ${guideCatalogSummary()}`,
    inputSchema: {
      type: 'object',
      properties: {
        guides: {
          type: 'array',
          items: { type: 'string' },
          description: 'Guide names to load, e.g. ["writing","formatting"]',
        },
      },
      required: ['guides'],
    },
  },
  {
    name: 'read_formats',
    description:
      'Read explicit cell formats in a range (bold/italic/underline/colors/number format/alignment/borders); only formatted cells are returned. ' +
      'Use when you need to "reuse the format from somewhere" or inspect current formatting; max 200 cells.',
    inputSchema: {
      type: 'object',
      properties: {
        range: { type: 'string', description: 'Range like "A1:D20"' },
        sheetId: {
          type: 'string',
          description:
            'Sheet to read from (id from get_workbook_context); reads the active sheet when omitted',
        },
      },
      required: ['range'],
    },
  },
  {
    name: 'read_sheet_features',
    description:
      "Read a worksheet's feature state: AutoFilter (range and column criteria), conditional formatting rules, data validation rules, defined names, " +
      'freeze panes, hidden/protected status, shapes and images, and page setup pending save this session. ' +
      'Read the current state before modifying or clearing any of these existing settings — never change them blindly.',
    inputSchema: {
      type: 'object',
      properties: {
        sheetId: {
          type: 'string',
          description: 'Target sheet id; reads the active sheet when omitted',
        },
      },
      required: [],
    },
  },
  {
    name: 'read_cells',
    description:
      'Read current values/formulas of specific scattered cells (use read_range for contiguous regions). Always read the affected cells before writing — never assume their contents. ' +
      'A cell whose stored value differs from its shown text carries a [type; raw value; number format] note, e.g. "A1: 10% [percent; raw 0.1; format 0%]" ' +
      'vs "A2: 10" (a plain number) vs "A3: 10 [text]" — calculate with the raw value; unannotated cells are plain text or General-format numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        addresses: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of cell addresses, e.g. ["A1","B2"], max 100',
        },
        sheetId: {
          type: 'string',
          description:
            'Sheet to read from (id from get_workbook_context); reads the active sheet when omitted',
        },
      },
      required: ['addresses'],
    },
  },
  {
    name: 'find_cells',
    description:
      'Search the whole workbook (or one sheet) for cells whose value or formula matches a query; returns Sheet!Address with the cell content. ' +
      'Plain text matches as a case-insensitive substring; regex=true treats the query as a case-insensitive JavaScript regex; ' +
      'errors_only=true finds formula error cells (#REF!, #DIV/0!, #VALUE!, #NAME?, #N/A, #NUM!, #NULL!) and query may then be omitted. ' +
      'For formula cells the matched value is the last calculated value. Prefer this over paging read_range when locating data or auditing errors.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text or regex to find; may be omitted only when errors_only=true',
        },
        regex: {
          type: 'boolean',
          description: 'Treat query as a JavaScript regex (default false)',
        },
        look_in: {
          type: 'string',
          enum: ['values', 'formulas', 'both'],
          default: 'both',
          description: 'What to match against (default both)',
        },
        sheetId: {
          type: 'string',
          description: 'Restrict the search to one sheet; searches every sheet when omitted',
        },
        errors_only: {
          type: 'boolean',
          description: 'Find cells whose calculated value is a formula error (default false)',
        },
        max_results: {
          type: 'integer',
          description: `Maximum matches returned, default ${DEFAULT_FIND_RESULTS}, max ${MAX_FIND_RESULTS}`,
        },
      },
      required: [],
    },
  },
  {
    name: 'select_range',
    description:
      "Select a range in the grid and scroll the user's view to it, activating its sheet. " +
      'Pure view navigation — changes no data, but it does replace whatever the user had selected. ' +
      'Use it only when they asked to be moved ("take me there", "select those rows"); to merely point at a ' +
      'location, cite it as [C42](sheetnav://C42) in your reply and let them click.',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          description: 'Range like "A1:D20"; a single cell is also accepted',
        },
        sheetId: { type: 'string', description: 'Target sheet id; defaults to the active sheet' },
      },
      required: ['range'],
    },
  },
  {
    name: 'trace_precedents',
    description:
      'List the cells/ranges a formula reads (its precedents) with their current values, flagging any precedent that itself holds an error value — ' +
      'the first step when diagnosing a broken formula ("why is C10 #DIV/0!?"). Depth 1; call again on a suspect precedent to walk further up the chain. ' +
      'Defined names are not expanded — resolve them via read_sheet_features and trace their ranges directly.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Formula cell to audit, e.g. "C10"' },
        sheetId: {
          type: 'string',
          description: 'Sheet the cell lives on; defaults to the active sheet',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'trace_dependents',
    description:
      'Find every formula in the workbook (all sheets) that reads a given cell — its dependents. ' +
      'Use before changing or deleting a cell to see what would break, or to follow how an error value propagates downstream. ' +
      'Dependents that reach the cell only through a defined name are not detected.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Target cell, e.g. "B2"' },
        sheetId: {
          type: 'string',
          description: 'Sheet the cell lives on; defaults to the active sheet',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'propose_operations',
    description:
      'Submit a batch of change operations, applied to the workbook immediately (the user can roll back with the [Undo] button or ⌘Z). Basic operations: ' +
      '{op:"set_cell",sheetId,address,value} | {op:"set_formula",sheetId,address,formula(starts with =)} | ' +
      '{op:"clear_cell",sheetId,address} | {op:"rename_sheet",sheetId,name}. ' +
      'Field definitions for the remaining operations live in the guides — load_guide before using them: ' +
      'writing(set_range/fill_range/copy_range/convert_to_values/clear_range/find_replace) | formatting(format_range) | ' +
      'layout(sort_range/merge_cells/unmerge_cells/set_row_height/set_col_width/set_rows_hidden/set_cols_hidden/set_freeze/set_page_setup) | ' +
      'structure(insert_rows/delete_rows/insert_cols/delete_cols/add_sheet/delete_sheet/' +
      'duplicate_sheet/set_sheet_hidden/move_sheet/protect_sheet) | ' +
      'charts(add_chart/edit_chart/delete_visual/add_sparkline/add_shape/edit_shape/add_image) | ' +
      'pivot(add_pivot/refresh_pivot) | ' +
      'table(add_table/add_table_row/add_table_column/delete_table_row/delete_table_column/delete_table) | ' +
      'data(set_hyperlink/set_filter/clear_filter/set_filter_criteria/add_conditional_format/' +
      'clear_conditional_formats/set_data_validation/set_note/add_defined_name/delete_defined_name). ' +
      'Limits: structural operations (row/column insert-delete, sheet add/delete/duplicate/move/hide) cannot share a batch with other classes; at most 2000 expanded cell changes — ' +
      'except the range-level bulk ops fill_range / copy_range / convert_to_values / clear_range / find_replace / sort_range / format_range, which handle up to 200,000 cells in one op ' +
      '(use fill_range to fill a formula or pattern down a whole column instead of huge set_range batches, ' +
      'copy_range to duplicate a large block once, convert_to_values to freeze formulas into their computed values); ' +
      'sheetId must be an id returned by get_workbook_context.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: { type: 'object' },
          description: 'Array of operations in the workbook DSL discriminated-union format',
        },
        summary: { type: 'string', description: 'One-sentence summary of this batch of changes' },
      },
      required: ['operations', 'summary'],
    },
  },
  {
    name: 'create_document',
    description:
      'Create a NEW standalone file in the default save folder and open it in a new tab; the current workbook is not modified. ' +
      "Types 'xlsx' (default) and 'csv' export ONE worksheet of THIS workbook: pass sheetId (defaults to the active sheet); the file gets the sheet's current displayed values (formula results; formulas and formatting are not carried over) and content must be omitted. " +
      'To split a workbook into separate files, call once per sheet. To export data that is not in a sheet yet, write it into a new sheet first (add_sheet + set_range), then export that sheet. ' +
      "Types 'docx' and 'pdf' take simple HTML in content (<h1>-<h6>, <p>, <ul>/<ol>/<li>, <table>, <pre>, <blockquote>; inline <strong>/<em>/<u>/<s>); type 'md' takes Markdown source; type 'html' takes a complete standalone HTML page (opens in the HTML editor) — use these when the user wants a report/summary as its own document. " +
      'title becomes the file name; xlsx/csv default it to the worksheet name.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['xlsx', 'csv', 'docx', 'pdf', 'md', 'html'],
          description: "target file type (default 'xlsx')",
        },
        sheetId: {
          type: 'string',
          description:
            'xlsx/csv only: the worksheet to export (id from get_workbook_context); defaults to the active sheet',
        },
        title: {
          type: 'string',
          description:
            'file name without extension (required for docx/pdf/md; xlsx/csv default to the sheet name)',
        },
        content: {
          type: 'string',
          description:
            'docx/pdf: simple HTML; md: Markdown source. Forbidden for xlsx/csv — their data comes from the worksheet',
        },
      },
      required: [],
    },
  },
]

export interface ToolExecution {
  output: string
  isError?: boolean
  /** true when propose_operations auto-applied a batch of changes */
  mutated: boolean
  summary: string
}

const fail = (summary: string, output: string): ToolExecution => ({
  output,
  isError: true,
  mutated: false,
  summary,
})

/** Optional sheetId input shared by the read tools: validated against the
 * workbook's sheet list so a bad id fails with a clear message instead of
 * silently reading empty cells. */
function parseReadSheetId(
  input: Record<string, unknown>,
  info: ActiveSheetInfo,
  summary: string,
): { sheetId: string | undefined } | { fail: ToolExecution } {
  const raw = input.sheetId
  if (raw === undefined || raw === null) return { sheetId: undefined }
  if (typeof raw !== 'string' || !raw.trim()) {
    return { fail: fail(summary, 'sheetId must be a non-empty string when given') }
  }
  const sheetId = raw.trim()
  if (!info.sheets.some((sheet) => sheet.id === sheetId)) {
    return {
      fail: fail(summary, `Unknown sheet: ${sheetId} (use an id from get_workbook_context)`),
    }
  }
  return { sheetId }
}

/** Clamp a range to the sheet's data extent before a streaming ensure; null
 * when the range lies entirely outside it (nothing to stream — cells there
 * are empty by definition). Sheets without a known extent pass through. */
function clampToExtent(bounds: RangeBounds, sheet: SheetRef | undefined): RangeBounds | null {
  if (sheet?.rows === undefined || sheet.columns === undefined) return bounds
  const endRow = Math.min(bounds.endRow, sheet.rows - 1)
  const endColumn = Math.min(bounds.endColumn, sheet.columns - 1)
  if (endRow < bounds.startRow || endColumn < bounds.startColumn) return null
  return { startRow: bounds.startRow, startColumn: bounds.startColumn, endRow, endColumn }
}

const RANGE_NOT_LOADED =
  'The requested cells could not be fully loaded; retry after workbook indexing completes.'

/** mirror of the docs/pdf tool-echo guard: reject tool-protocol output pasted
 * as document content (create_document docx/pdf) */
function contentEchoError(content: string): string | null {
  if (/<\/?tool_response>/i.test(content)) {
    return 'content contains a literal <tool_response> tag — that is tool-protocol output, not document content; retry with the actual document HTML'
  }
  if (/"index"\s*:\s*\d+\s*,\s*"type"\s*:\s*"/.test(content)) {
    return 'content contains a raw JSON dump, not an HTML fragment; retry with simple HTML (e.g. <p>…</p>)'
  }
  return null
}

/** Shared input validation for the two formula-audit tools. */
function parseAuditAddress(
  input: Record<string, unknown>,
  summary: string,
): { address: string; sheetId: string | undefined } | { fail: ToolExecution } {
  const raw = input.address
  if (typeof raw !== 'string' || !raw.trim()) {
    return { fail: fail(summary, 'address must be a non-empty string') }
  }
  const address = raw.trim().toUpperCase().replace(/\$/g, '')
  if (!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(address)) {
    return {
      fail: fail(summary, `Cannot parse cell address: ${raw} (expected a single cell like "C10")`),
    }
  }
  const sheetIdRaw = input.sheetId
  return {
    address,
    sheetId: typeof sheetIdRaw === 'string' && sheetIdRaw.trim() ? sheetIdRaw.trim() : undefined,
  }
}

export function buildWorkbookContext(deps: SheetsSkillDeps): string {
  const info = deps.getActiveSheetInfo()
  if (info.mode === 'none') return 'No workbook is currently open.'
  const dims = (sheet: SheetRef): string => {
    if (sheet.rows === undefined || sheet.columns === undefined) return ''
    if (sheet.rows === 0 || sheet.columns === 0) return ', no data (empty sheet)'
    return `, data extent about ${sheet.rows} rows × ${sheet.columns} columns`
  }
  const active = info.sheets.find((sheet) => sheet.id === info.sheetId)
  const lines = [
    `Active sheet: ${info.sheetName} (id=${info.sheetId}${active ? dims(active) : ''})`,
    info.mode === 'demo'
      ? `Mode: demo workbook, current revision=${info.revision}`
      : info.streaming
        ? 'Mode: imported file in LARGE-FILE STREAMING MODE — the file is too big for a full load, so the grid ' +
          'materializes the viewed region on demand. Consequences: (1) formulas you write stay live — their ' +
          'referenced file cells are loaded into the engine automatically — but only within a session budget of ' +
          '~50,000 referenced cells; batches beyond it are rejected: compute with aggregate_range and write static ' +
          'values instead; (2) to extract/split rows, use copy_range with filterColumn/filterValues (copies matching ' +
          'rows as static values, reading the real file data) into a sheet created with add_sheet rows/columns sized ' +
          'to the expected data (aggregate_range gives per-value counts) — never FILTER-formula spills; ' +
          '(3) add_pivot, refresh_pivot, duplicate_sheet, and filter edits are unavailable on the ' +
          "file's sheets; sort_range works, but ranges of 2000 cells or fewer must be read_range'd (loaded) first. " +
          'Sheets added this session are fully live and exempt from all of this.'
        : 'Mode: imported real xlsx file (some regions may still be streaming in)',
  ]
  if (active?.rows && active.columns) {
    lines.push(
      `Active sheet data area: A1:${columnLabel(active.columns - 1)}${active.rows}` +
        ' (answer data-size questions directly from this — do not tally block by block with read_range)',
    )
  }
  if (info.sheets.length > 1) {
    lines.push(
      `All sheets: ${info.sheets.map((sheet) => `${sheet.name} (id=${sheet.id}${dims(sheet)})`).join(', ')}`,
    )
  }
  const oversized = info.sheets.filter((sheet) => sheet.readOnlyOversized)
  if (oversized.length > 0) {
    lines.push(
      `READ-ONLY sheets: ${oversized.map((sheet) => sheet.name).join(', ')} — the worksheet XML is above ` +
        'the save-patch limit, so edits there can never be saved and every mutating op on them is rejected. ' +
        'Read them freely (read_range/aggregate_range/copy_range source) and write results to other sheets.',
    )
  }
  if (info.selection) {
    const named = info.selectionColumns ?? []
    // The range alone leaves the model to re-derive which column the user meant
    // from the header row; name it here so "this column" resolves by meaning.
    const columns = named.length
      ? ` (the whole ${named.map((name) => `"${name}"`).join(', ')} column${named.length > 1 ? 's' : ''})`
      : ''
    lines.push(
      info.selectionFrozen
        ? `User selection: ${info.selection}${columns} — captured when the user sent this message, so it is ` +
            'what "this column / these rows / the selected part" refers to. It stays fixed for the ' +
            'whole run even if the user clicks elsewhere while you work.'
        : `Current selection: ${info.selection}${columns}`,
    )
  }
  if (info.loadedRange) {
    lines.push(`Currently loaded viewport: ${info.loadedRange} (not the worksheet data extent)`)
  }
  if (info.merges && info.merges.length > 0) {
    lines.push(`Merged ranges on the active sheet: ${info.merges.slice(0, 50).join(', ')}`)
  }
  if (info.charts && info.charts.length > 0) {
    lines.push(
      'Charts in the workbook (use the path below with edit_chart to edit an existing chart; use add_chart to create one):',
    )
    for (const chart of info.charts) {
      lines.push(
        `- ${chart.path} | title: ${chart.title || '(none)'} | type: ${chart.types} | sheetId: ${chart.sheetId}`,
      )
    }
  }
  if (info.knownAddresses.length > 0) {
    lines.push(
      `Known non-empty cells (may be incomplete): ${info.knownAddresses.slice(0, 200).join(', ')}`,
    )
  } else {
    lines.push(
      'No known non-empty cell information yet; read on demand with read_range/read_cells.',
    )
  }
  return lines.join('\n')
}

function describeFormatState(format: CellFormatState): string {
  const parts: string[] = []
  if (format.bold) parts.push('bold')
  if (format.italic) parts.push('italic')
  if (format.underline) parts.push('underline')
  if (format.strikethrough) parts.push('strikethrough')
  if (format.fontFamily) parts.push(`font ${format.fontFamily}`)
  if (format.fontSize) parts.push(`size ${format.fontSize}`)
  if (format.fontColor) parts.push(`font color ${format.fontColor}`)
  if (format.fillColor) parts.push(`fill ${format.fillColor}`)
  if (format.numberFormat) parts.push(`number format ${format.numberFormat}`)
  if (format.horizontalAlign) parts.push(`align ${format.horizontalAlign}`)
  if (format.verticalAlign) parts.push(`valign ${format.verticalAlign}`)
  if (format.wrapText) parts.push('wrap')
  if (format.border) {
    parts.push(
      `border ${format.border.type}${format.border.color ? ` ${format.border.color}` : ''}`,
    )
  }
  return parts.join(', ') || '(none)'
}

// Cell text is emitted into tab/newline-delimited tool output (read_range grid,
// read_cells lists, plan summaries), where raw control characters would tear the
// line/column structure apart and scramble the model's view of the grid. Escape
// them — and backslash itself, so the encoding stays unambiguous. Univer streams
// in-cell paragraph breaks as \r (the file model uses \n; see edit-journal's
// dataStream conversion), so CR/CRLF are normalized to \n first: the model sees
// a single line-break representation, and echoing the same `\n` escape inside
// JSON string values of write operations round-trips into real line breaks.
function escapeCellText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '\\n')
}

function formatCellScalar(cell: { value: CellScalar; formula?: string | undefined }): string {
  // Formula cells prefer the value (the AI reasons from computed values, with
  // the formula as provenance); when the value isn't computed yet, give only the
  // formula
  if (cell.formula) {
    return cell.value === null || cell.value === undefined
      ? escapeCellText(cell.formula)
      : `${escapeCellText(String(cell.value))} (${escapeCellText(cell.formula)})`
  }
  if (cell.value === null) return '(empty)'
  return escapeCellText(String(cell.value))
}

/** Text whose content reads as a number: the model must not treat it as one. */
const NUMERIC_LOOKING_TEXT = /^\s*[-+]?[\d.,\s]*\d[\d.,\s]*%?\s*$/

/**
 * The [type; raw; format] note for a cell whose shown text alone would
 * mislead: a percent/currency/date, a number with an explicit format, text
 * that looks like a number, or any cell whose stored value differs from its
 * display. Plain text and General numbers get no note.
 */
function cellTypeNote(cell: CellRead): string | null {
  const { type, rawValue: raw, value: display } = cell
  if (type === undefined || type === 'empty' || type === 'error') return null
  const rawDiffers =
    raw !== undefined &&
    raw !== null &&
    String(raw).toUpperCase() !== String(display ?? '').toUpperCase()
  const numericText =
    type === 'text' && typeof display === 'string' && NUMERIC_LOOKING_TEXT.test(display)
  const notable =
    rawDiffers ||
    numericText ||
    cell.numberFormat !== undefined ||
    type === 'percent' ||
    type === 'currency' ||
    type === 'date' ||
    type === 'boolean'
  if (!notable) return null
  const parts: string[] = [type]
  if (rawDiffers) parts.push(`raw ${escapeCellText(String(raw))}`)
  if (cell.numberFormat) parts.push(`format ${escapeCellText(cell.numberFormat)}`)
  return parts.join('; ')
}

/**
 * A read cell's text plus its notes. A formula value that is the file's
 * cached result is labelled; once inputs were edited this session it is
 * replaced by NOT RECALCULATED so it can never pass for the answer.
 */
/** "unsupported function: X — …" for a formula calling functions the engine lacks. */
function unsupportedNote(cell: Pick<CellRead, 'unsupportedFunctions'>): string | null {
  const missing = cell.unsupportedFunctions ?? []
  if (missing.length === 0) return null
  return (
    `unsupported function${missing.length > 1 ? 's' : ''}: ${missing.join(', ')} — ` +
    'the formula engine in this app cannot calculate it, so this is not a real result; ' +
    'tell the user, or rewrite the formula with supported functions'
  )
}

function describeReadCell(cell: CellRead): { text: string; notes: string[] } {
  const notes: string[] = []
  const unsupported = unsupportedNote(cell)
  if (unsupported) notes.push(unsupported)
  const typeNote = cellTypeNote(cell)
  if (cell.valueSource === 'cache' && cell.formula) {
    const formula = escapeCellText(cell.formula)
    const shown = cell.value === null ? '(empty)' : escapeCellText(String(cell.value))
    const engine =
      cell.engineResult !== undefined
        ? `the formula engine cannot calculate this formula (it returns ${escapeCellText(String(cell.engineResult))}); `
        : ''
    if (cell.staleCache) {
      notes.push(
        `not recalculated — ${engine}the file's cached value from the last save (${shown}) may be out of date ` +
          'because cells were edited this session; do not give it as the answer',
      )
      return { text: `NOT RECALCULATED (${formula})`, notes }
    }
    if (typeNote) notes.push(typeNote)
    notes.push(
      `cached value from the file — ${engine}not recalculated by this app; no inputs were edited this session`,
    )
    return { text: formatCellScalar(cell), notes }
  }
  if (typeNote) notes.push(typeNote)
  return { text: formatCellScalar(cell), notes }
}

/** Cap on the per-cell type lines read_range lists under its grid. */
const MAX_TYPE_NOTES = 200

function formatPlanSummary(plan: ChangePlan): string {
  const parts: string[] = []
  if (plan.structuralChanges.length > 0) {
    parts.push(plan.structuralChanges.map((change) => change.label).join('; '))
  }
  if (plan.formatChanges.length > 0) {
    parts.push(plan.formatChanges.map((change) => change.label).join('; '))
  }
  if (plan.cellChanges.length > 0) {
    const shown = plan.cellChanges.slice(0, 20)
    const rest = plan.cellChanges.length - shown.length
    parts.push(
      shown
        .map((c) => `${c.address}: ${formatCellScalar(c.before)} → ${formatCellScalar(c.after)}`)
        .join('; ') + (rest > 0 ? `; …${rest} more cells` : ''),
    )
  }
  if (plan.sheetRenames.length > 0) {
    parts.push(plan.sheetRenames.map((r) => `sheet ${r.before} → ${r.after}`).join('; '))
  }
  return parts.join(' | ') || '(no changes)'
}

const MAX_SUMMARIZE_CELLS = 1_000_000
const DEFAULT_SUMMARIZE_GROUPS = 50
const MAX_SUMMARIZE_GROUPS = 200
const MAX_TOTAL_ROWS_LISTED = 20

/** A column letter of the sheet ("E", "aa") as a 0-based index, or null. */
function parseColumnLetter(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\s*\$?[A-Za-z]{1,3}\s*$/.test(raw)) return null
  try {
    return parseAddress(`${raw.trim().replace('$', '').toUpperCase()}1`).column
  } catch {
    return null
  }
}

/** Round away binary float noise (0.1 + 0.2) without hiding real digits. */
const formatResultNumber = (value: number): string => String(Number(value.toPrecision(15)))

function formatSummary(
  result: SummarizeResult,
  context: {
    rangeLabel: string
    fn: SummarizeFunction
    valueColumn: number | undefined
    where: readonly Criterion[]
    groupBy: number | undefined
    hiddenMode: 'include' | 'skip'
    includeTotals: boolean
  },
): string {
  const named = (column: number): string => {
    const header = result.headers.get(column)
    return header ? `${columnLabel(column)} "${escapeCellText(header)}"` : columnLabel(column)
  }
  const condition = (criterion: Criterion): string =>
    criterion.op === 'blank' || criterion.op === 'not_blank'
      ? `${named(criterion.column)} is ${criterion.op === 'blank' ? 'blank' : 'not blank'}`
      : `${named(criterion.column)} ${criterion.op.replace('_', ' ')} ${
          typeof criterion.value === 'string'
            ? `"${escapeCellText(criterion.value)}"`
            : String(criterion.value)
        }`
  const calculation =
    context.fn === 'count'
      ? 'count of matching rows'
      : `${context.fn} of ${named(context.valueColumn!)}`
  const lines = [
    `Summary of ${context.rangeLabel}${result.headers.size > 0 ? ` (header row ${result.firstDataRow})` : ''}:`,
    `- calculation: ${calculation}; filter: ${context.where.length > 0 ? context.where.map(condition).join(' AND ') : 'none'}` +
      (context.groupBy !== undefined ? `; group by ${named(context.groupBy)}` : ''),
    `- rows processed: ${result.rowsProcessed}; rows matching: ${result.rowsMatched}; hidden/filtered rows: ${result.hiddenRows}` +
      (result.hiddenRows === 0
        ? ''
        : context.hiddenMode === 'skip'
          ? ' (skipped — visible rows only)'
          : ' (included — pass skipHiddenRows=true for visible rows only)'),
  ]
  if (result.totalRows.length > 0) {
    const listed = result.totalRows.slice(0, MAX_TOTAL_ROWS_LISTED)
    lines.push(
      `- total/subtotal rows: ${result.totalRows.length} (` +
        (context.includeTotals
          ? 'INCLUDED — they restate data rows, so the result may count amounts twice'
          : 'EXCLUDED so their amounts are not counted twice; pass includeTotalRows=true to count them') +
        '):',
      ...listed.map(
        (entry) => `  row ${entry.row + 1} ${entry.kind}: ${escapeCellText(entry.reason)}`,
      ),
    )
    if (result.totalRows.length > listed.length) {
      lines.push(`  …${result.totalRows.length - listed.length} more`)
    }
  }
  if (context.fn !== 'count') {
    const skipped = (
      [
        ['text', 'text, not converted to numbers'],
        ['error', 'error'],
        ['blank', 'blank'],
        ['boolean', 'TRUE/FALSE'],
      ] as const
    )
      .filter(([kind]) => result.skipped[kind].count > 0)
      .map(([kind, label]) => {
        const bucket = result.skipped[kind]
        const examples = bucket.examples
          .filter((example) => example.value !== null && example.value !== '')
          .map(
            (example) =>
              `${example.address} ${typeof example.value === 'string' ? `"${escapeCellText(example.value)}"` : String(example.value)}`,
          )
        return `${bucket.count} ${label}${examples.length > 0 ? ` (e.g. ${examples.join(', ')})` : ''}`
      })
    lines.push(
      `- value cells used: ${result.valuesUsed}; skipped: ${skipped.length > 0 ? skipped.join('; ') : 'none'}`,
    )
  }
  if (result.criteriaNotComparable > 0) {
    lines.push(
      `- condition cells that could not be compared as numbers (text or errors, treated as not matching): ${result.criteriaNotComparable}`,
    )
  }
  if (result.cachedFormulaCells > 0) {
    lines.push(
      `- ${result.cachedFormulaCells} formula cells read with their cached values from the file (not recalculated by this app; no inputs were edited this session) — say so in your answer`,
    )
  }
  lines.push(
    `- result: ${result.result === null ? '(no numeric values)' : formatResultNumber(result.result)}`,
  )
  if (context.groupBy !== undefined) {
    lines.push(`Groups (${result.groupCount}, largest result first):`)
    for (const group of result.groups) {
      lines.push(
        `- ${escapeCellText(group.key)}: ${group.result === null ? '(no numeric values)' : formatResultNumber(group.result)} ` +
          `(rows ${group.rows}${context.fn === 'count' ? '' : `, values used ${group.valuesUsed}`})`,
      )
    }
    if (result.groupCount > result.groups.length) {
      lines.push(
        `…${result.groupCount - result.groups.length} more groups not listed (their rows are in the total); raise maxGroups to see them.`,
      )
    }
  }
  return lines.join('\n')
}

const DEFAULT_COMPARE_LISTED = 50
const MAX_COMPARE_LISTED = 200

function formatComparison(
  result: ReconcileResult,
  context: {
    leftLabel: string
    rightLabel: string
    leftKey: number
    rightKey: number
    tolerance: number
    hiddenMode: 'include' | 'skip'
    includeTotals: boolean
    maxListed: number
  },
): string {
  const named = (side: ReconcileSideResult, column: number): string => {
    const header = side.headers.get(column)
    return header ? `${columnLabel(column)} "${escapeCellText(header)}"` : columnLabel(column)
  }
  const show = (value: CellScalar): string =>
    value === null || value === ''
      ? '(empty)'
      : typeof value === 'string'
        ? `"${escapeCellText(value)}"`
        : String(value)
  const sideLine = (name: string, side: ReconcileSideResult): string =>
    `- ${name}: rows processed ${side.rowsProcessed}; keys ${side.keys}; blank keys: ${side.blankKeys}; ` +
    `duplicate keys: ${side.duplicateKeys.length}` +
    (side.duplicateKeys.length > 0
      ? ` (only the first row of each is compared: ${side.duplicateKeys
          .slice(0, 10)
          .map(
            (entry) =>
              `"${escapeCellText(entry.key)}" rows ${entry.rows.map((row) => row + 1).join('/')}`,
          )
          .join(', ')})`
      : '') +
    `; hidden/filtered rows: ${side.hiddenRows}${side.hiddenRows > 0 ? (context.hiddenMode === 'skip' ? ' (skipped)' : ' (included)') : ''}` +
    (side.totalRows.length > 0
      ? context.includeTotals
        ? `; total/subtotal rows included: ${side.totalRows.length}`
        : `; total/subtotal rows excluded: ${side.totalRows.length} (${side.totalRows
            .slice(0, 5)
            .map((entry) => `row ${entry.row + 1}: ${escapeCellText(entry.reason)}`)
            .join('; ')})`
      : '')
  const lines = [
    `Comparison of ${context.leftLabel} (left) with ${context.rightLabel} (right) by key ` +
      `${named(result.left, context.leftKey)} ↔ ${named(result.right, context.rightKey)}; compared columns: ` +
      (result.pairs.length > 0
        ? result.pairs
            .map(([left, right]) => `${named(result.left, left)} ↔ ${named(result.right, right)}`)
            .join(', ')
        : 'none (no shared header names — keys only; pass leftColumns/rightColumns to compare values)') +
      (context.tolerance > 0 ? ` (numeric tolerance ${context.tolerance})` : ''),
    sideLine('left', result.left),
    sideLine('right', result.right),
    `- matched keys: ${result.matched} (${result.identical} identical, ${result.matched - result.identical} with differences); ` +
      `only in left: ${result.onlyLeft.length}; only in right: ${result.onlyRight.length}`,
  ]
  const listKeys = (title: string, entries: readonly { key: string; row: number }[]): void => {
    if (entries.length === 0) return
    lines.push(
      `${title} (${entries.length}): ${entries
        .slice(0, context.maxListed)
        .map((entry) => `"${escapeCellText(entry.key)}" (row ${entry.row + 1})`)
        .join(
          ', ',
        )}${entries.length > context.maxListed ? `, …${entries.length - context.maxListed} more` : ''}`,
    )
  }
  listKeys('Only in left', result.onlyLeft)
  listKeys('Only in right', result.onlyRight)
  if (result.differences.length > 0) {
    lines.push(`Differences (${result.differences.length} cell(s)):`)
    for (const difference of result.differences.slice(0, context.maxListed)) {
      const note =
        difference.delta !== undefined
          ? ` (right − left = ${difference.delta})`
          : typeof difference.left !== typeof difference.right &&
              difference.left !== null &&
              difference.right !== null
            ? ` (${typeof difference.left === 'number' ? 'number' : typeof difference.left === 'string' ? 'text' : typeof difference.left} vs ${typeof difference.right === 'number' ? 'number' : typeof difference.right === 'string' ? 'text' : typeof difference.right})`
            : ''
      lines.push(
        `- "${escapeCellText(difference.key)}": ${named(result.left, difference.leftColumn)} ${show(difference.left)} ↔ ` +
          `${named(result.right, difference.rightColumn)} ${show(difference.right)}${note} ` +
          `[left row ${difference.leftRow + 1}, right row ${difference.rightRow + 1}]`,
      )
    }
    if (result.differences.length > context.maxListed) {
      lines.push(
        `…${result.differences.length - context.maxListed} more differences not listed; raise maxListed.`,
      )
    }
  }
  if (result.left.cachedFormulaCells + result.right.cachedFormulaCells > 0) {
    lines.push(
      `- ${result.left.cachedFormulaCells + result.right.cachedFormulaCells} formula cells read with their cached values from the file (not recalculated by this app; no inputs were edited this session) — say so in your answer`,
    )
  }
  return lines.join('\n')
}

export function executeWorkbookTool(
  call: AgentToolCall,
  deps: SheetsSkillDeps,
): ToolExecution | Promise<ToolExecution> {
  switch (call.name) {
    case 'get_workbook_context':
      return {
        output: buildWorkbookContext(deps),
        mutated: false,
        summary: t('aiToolWorkbookContext'),
      }

    case 'read_range': {
      const raw = call.input.range
      if (typeof raw !== 'string' || !raw.trim())
        return fail(t('aiToolReadRange'), 'range must be a non-empty string')
      let bounds
      try {
        bounds = parseRange(raw.trim().toUpperCase())
      } catch {
        return fail(t('aiToolReadRange'), `Cannot parse range: ${raw}`)
      }
      if (rangeCellCount(bounds) > MAX_READ_RANGE_CELLS) {
        return fail(
          t('aiToolReadRange'),
          `The range contains more than ${MAX_READ_RANGE_CELLS} cells; read it in multiple calls`,
        )
      }
      const info = deps.getActiveSheetInfo()
      const parsedSheet = parseReadSheetId(call.input, info, t('aiToolReadRange'))
      if ('fail' in parsedSheet) return parsedSheet.fail
      const sheetId = parsedSheet.sheetId
      const target = info.sheets.find((sheet) => sheet.id === (sheetId ?? info.sheetId))
      if (target?.rows !== undefined && target.columns !== undefined) {
        if (target.rows === 0 || target.columns === 0) {
          return fail(t('aiToolReadRange'), 'The worksheet has no data (empty extent).')
        }
        if (bounds.endRow >= target.rows || bounds.endColumn >= target.columns) {
          return fail(
            t('aiToolReadRange'),
            `The requested range is outside the worksheet data extent A1:${columnLabel(target.columns - 1)}${target.rows}.`,
          )
        }
      }
      const executeRead = (): ToolExecution => {
        const normalizedRange = `${formatAddress(bounds.startRow, bounds.startColumn)}:${formatAddress(bounds.endRow, bounds.endColumn)}`
        const metadata =
          target?.rows && target.columns
            ? `Read metadata: requested range ${normalizedRange}; authoritative worksheet data extent A1:${columnLabel(target.columns - 1)}${target.rows} (${target.rows} worksheet rows including any header). Do not infer total rows or records from the requested range.`
            : `Read metadata: requested range ${normalizedRange}; worksheet data extent is unknown. Do not infer total rows or records from the requested range.`
        const addresses: string[] = []
        for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
          for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
            addresses.push(formatAddress(row, column))
          }
        }
        const cells = deps.readCells(addresses, sheetId)
        const hidden = new Map(
          (deps.hiddenRows?.(sheetId, bounds) ?? []).map((entry) => [entry.row, entry.reason]),
        )
        const rowLabel = (row: number): string => {
          const reason = hidden.get(row)
          return reason === undefined
            ? String(row + 1)
            : `${row + 1} (${reason === 'filtered' ? 'filtered out' : 'hidden'})`
        }
        const header = [
          '',
          ...Array.from({ length: bounds.endColumn - bounds.startColumn + 1 }, (_, offset) =>
            columnLabel(bounds.startColumn + offset),
          ),
        ].join('\t')
        const rows: string[] = [metadata, header]
        const typeNotes: string[] = []
        for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
          const columns: string[] = [rowLabel(row)]
          for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
            const address = formatAddress(row, column)
            const cell = cells[address]
            const described = cell ? describeReadCell(cell) : null
            if (described && described.notes.length > 0) {
              typeNotes.push(`${address}: ${described.notes.join('; ')}`)
            }
            columns.push(
              cell
                ? cell.value === null && cell.valueSource !== 'cache'
                  ? escapeCellText(cell.formula ?? '')
                  : (described?.text ?? '')
                : '',
            )
          }
          rows.push(columns.join('\t'))
        }
        if (typeNotes.length > 0) {
          rows.push(
            'Cell types and value sources (cells not listed hold plain text, General-format numbers or freshly calculated formulas; raw = the stored value behind the shown text):',
            ...typeNotes.slice(0, MAX_TYPE_NOTES),
          )
          if (typeNotes.length > MAX_TYPE_NOTES) {
            rows.push(
              `…${typeNotes.length - MAX_TYPE_NOTES} more typed cells not listed — read_cells shows them one by one.`,
            )
          }
        }
        if (hidden.size > 0) {
          rows.push(
            `Hidden rows in this range: ${[...hidden]
              .map(([row]) => rowLabel(row))
              .join(', ')} — not visible to the user; ` +
              'say whether your answer includes them (aggregate_range skipHiddenRows=true leaves them out).',
          )
        }
        return {
          output: rows.join('\n'),
          mutated: false,
          summary: t('aiToolReadRangeOf', { range: raw.trim().toUpperCase() }),
        }
      }
      const loading = deps.ensureRangeLoaded?.(bounds, sheetId)
      if (loading instanceof Promise) {
        return loading.then((loaded) =>
          loaded
            ? executeRead()
            : fail(
                t('aiToolReadRange'),
                'The requested range could not be fully loaded; retry after workbook indexing completes.',
              ),
        )
      }
      if (loading === false) {
        return fail(
          t('aiToolReadRange'),
          'The requested range could not be fully loaded; retry after workbook indexing completes.',
        )
      }
      return executeRead()
    }

    case 'aggregate_range': {
      const raw = call.input.range
      if (typeof raw !== 'string' || !raw.trim())
        return fail(t('aiToolAggregate'), 'range must be a non-empty string')
      const rangeLabel = raw.trim().toUpperCase()
      let bounds
      try {
        bounds = parseRange(rangeLabel)
      } catch {
        return fail(t('aiToolAggregate'), `Cannot parse range: ${raw}`)
      }
      if (rangeCellCount(bounds) > MAX_AGGREGATE_CELLS) {
        return fail(
          t('aiToolAggregate'),
          `The range contains more than ${MAX_AGGREGATE_CELLS.toLocaleString('en-US')} cells; aggregate one column (or a smaller block) at a time.`,
        )
      }
      if (!deps.aggregateRange) {
        return fail(t('aiToolAggregate'), 'aggregate_range is not available in this context.')
      }
      const parsedSheet = parseReadSheetId(
        call.input,
        deps.getActiveSheetInfo(),
        t('aiToolAggregate'),
      )
      if ('fail' in parsedSheet) return parsedSheet.fail
      const sheetId = parsedSheet.sheetId
      const topRaw = call.input.topValues
      const topValues =
        typeof topRaw === 'number' && Number.isFinite(topRaw)
          ? Math.min(Math.max(Math.floor(topRaw), 0), MAX_AGGREGATE_TOP_VALUES)
          : DEFAULT_AGGREGATE_TOP_VALUES
      const hiddenMode = call.input.skipHiddenRows === true ? 'skip' : 'include'
      return deps.aggregateRange(sheetId, bounds, { hiddenRows: hiddenMode }).then((outcome) => {
        if (!outcome.ok) return fail(t('aiToolAggregate'), outcome.error)
        const hiddenLine =
          outcome.hiddenRows === undefined
            ? '- hidden/filtered rows: not checked for this range'
            : outcome.hiddenRows === 0
              ? '- hidden/filtered rows in the range: 0'
              : hiddenMode === 'skip'
                ? `- hidden/filtered rows in the range: ${outcome.hiddenRows.toLocaleString('en-US')} (SKIPPED — the statistics cover visible rows only)`
                : `- hidden/filtered rows in the range: ${outcome.hiddenRows.toLocaleString('en-US')} (INCLUDED in the statistics; pass skipHiddenRows=true for visible rows only)`
        const cached = outcome.cachedFormulaCells ?? 0
        if (cached > 0 && outcome.staleCache) {
          return {
            output:
              `NOT RECALCULATED: ${cached.toLocaleString('en-US')} formula cell(s) in ${rangeLabel} hold the file's cached values ` +
              'from the last save, and cells were edited this session, so statistics over them may be out of date — ' +
              'they are withheld. Do not give a total for this range as the answer; tell the user it could not be recalculated ' +
              '(writing the formula on a sheet lets the engine calculate it live), or aggregate a range without formulas.\n' +
              hiddenLine,
            mutated: false,
            summary: t('aiToolAggregateOf', { range: rangeLabel }),
          }
        }
        const cachedLine =
          cached > 0
            ? `\n- ${cached.toLocaleString('en-US')} formula cells counted with their cached values from the file (not recalculated by this app; no inputs were edited this session) — say so in your answer`
            : ''
        return {
          output: `${formatRangeAggregate(rangeLabel, outcome.aggregate, topValues)}\n${hiddenLine}${cachedLine}`,
          mutated: false,
          summary: t('aiToolAggregateOf', { range: rangeLabel }),
        }
      })
    }

    case 'summarize_range': {
      const summary = t('aiToolSummarize')
      const raw = call.input.range
      if (typeof raw !== 'string' || !raw.trim())
        return fail(summary, 'range must be a non-empty string')
      let bounds: RangeBounds
      try {
        bounds = parseRange(raw.trim().toUpperCase().replace(/\$/g, ''))
      } catch {
        return fail(summary, `Cannot parse range: ${raw}`)
      }
      const hasHeader = call.input.hasHeader !== false
      if (hasHeader && bounds.endRow === bounds.startRow) {
        return fail(summary, 'The range holds only its header row; include the data rows below it.')
      }
      const column = (name: string, value: unknown): number | { error: string } => {
        const index = parseColumnLetter(value)
        if (index === null) return { error: `${name} must be a column letter like "E"` }
        if (index < bounds.startColumn || index > bounds.endColumn) {
          return {
            error: `${name} ${String(value).trim().toUpperCase()} is outside the range ${raw.trim().toUpperCase()}`,
          }
        }
        return index
      }
      let valueColumn: number | undefined
      if (call.input.valueColumn !== undefined) {
        const parsed = column('valueColumn', call.input.valueColumn)
        if (typeof parsed !== 'number') return fail(summary, parsed.error)
        valueColumn = parsed
      }
      const fnRaw = call.input.function ?? (valueColumn === undefined ? 'count' : 'sum')
      if (
        fnRaw !== 'sum' &&
        fnRaw !== 'count' &&
        fnRaw !== 'average' &&
        fnRaw !== 'min' &&
        fnRaw !== 'max'
      ) {
        return fail(summary, 'function must be one of sum/count/average/min/max')
      }
      const fn: SummarizeFunction = fnRaw
      if (fn !== 'count' && valueColumn === undefined) {
        return fail(
          summary,
          `${fn} needs valueColumn (the column letter whose numbers to aggregate)`,
        )
      }
      let groupBy: number | undefined
      if (call.input.groupBy !== undefined) {
        const parsed = column('groupBy', call.input.groupBy)
        if (typeof parsed !== 'number') return fail(summary, parsed.error)
        groupBy = parsed
      }
      const whereRaw = call.input.where ?? []
      if (!Array.isArray(whereRaw)) return fail(summary, 'where must be an array of conditions')
      const where: Criterion[] = []
      for (const entry of whereRaw) {
        const condition = (entry ?? {}) as Record<string, unknown>
        const parsed = column('where.column', condition.column)
        if (typeof parsed !== 'number') return fail(summary, parsed.error)
        const op = condition.op
        if (typeof op !== 'string' || !(CRITERION_OPS as readonly string[]).includes(op)) {
          return fail(summary, `where.op must be one of ${CRITERION_OPS.join(' ')}`)
        }
        const value = condition.value
        if (op !== 'blank' && op !== 'not_blank') {
          if (
            typeof value !== 'string' &&
            typeof value !== 'number' &&
            typeof value !== 'boolean'
          ) {
            return fail(summary, `where.value is required for op ${op}`)
          }
        }
        where.push({
          column: parsed,
          op: op as CriterionOp,
          ...(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? { value }
            : {}),
        })
      }
      const used = [
        ...where.map((criterion) => criterion.column),
        ...(fn !== 'count' && valueColumn !== undefined ? [valueColumn] : []),
        ...(groupBy !== undefined ? [groupBy] : []),
      ]
      // Only the columns up to the last one the calculation touches are read;
      // the range's first columns stay in so total-row labels are seen.
      const readBounds: RangeBounds = {
        startRow: bounds.startRow,
        endRow: bounds.endRow,
        startColumn: bounds.startColumn,
        endColumn: used.length > 0 ? Math.max(...used) : bounds.startColumn,
      }
      if (rangeCellCount(readBounds) > MAX_SUMMARIZE_CELLS) {
        return fail(
          summary,
          `The columns used span more than ${MAX_SUMMARIZE_CELLS.toLocaleString('en-US')} cells; summarize fewer rows at a time.`,
        )
      }
      if (!deps.collectRows)
        return fail(summary, 'summarize_range is not available in this context.')
      const info = deps.getActiveSheetInfo()
      const parsedSheet = parseReadSheetId(call.input, info, summary)
      if ('fail' in parsedSheet) return parsedSheet.fail
      const sheetId = parsedSheet.sheetId
      const sheetName =
        info.sheets.find((sheet) => sheet.id === (sheetId ?? info.sheetId))?.name ?? info.sheetName
      const groupsRaw = call.input.maxGroups
      const maxGroups =
        typeof groupsRaw === 'number' && Number.isFinite(groupsRaw)
          ? Math.min(Math.max(Math.floor(groupsRaw), 1), MAX_SUMMARIZE_GROUPS)
          : DEFAULT_SUMMARIZE_GROUPS
      const hiddenMode = call.input.skipHiddenRows === true ? 'skip' : 'include'
      const dataStart = bounds.startRow + (hasHeader ? 1 : 0)
      const rangeLabel = `${sheetName}!${formatAddress(dataStart, bounds.startColumn)}:${formatAddress(bounds.endRow, bounds.endColumn)}`
      return deps.collectRows(sheetId, readBounds).then((outcome) => {
        if (!outcome.ok) return fail(summary, outcome.error)
        const result = summarizeRows(outcome.rows, {
          startRow: readBounds.startRow,
          startColumn: readBounds.startColumn,
          hasHeader,
          fn,
          valueColumn,
          where,
          groupBy,
          hiddenRows: hiddenMode,
          totalRows: call.input.includeTotalRows === true ? 'include' : 'skip',
          maxGroups,
        })
        const done = t('aiToolSummarizeOf', { range: rangeLabel })
        if (result.cachedFormulaCells > 0 && outcome.staleInputs) {
          return {
            output:
              `NOT RECALCULATED: ${result.cachedFormulaCells} formula cell(s) used by this calculation in ${rangeLabel} hold the ` +
              "file's cached values from the last save, and cells were edited this session, so the result may be out of date — it is withheld. " +
              'Tell the user it could not be recalculated (writing the formula on a sheet lets the engine calculate it live).',
            mutated: false,
            summary: done,
          }
        }
        return {
          output: formatSummary(result, {
            rangeLabel,
            fn,
            valueColumn,
            where,
            groupBy,
            hiddenMode,
            includeTotals: call.input.includeTotalRows === true,
          }),
          mutated: false,
          summary: done,
        }
      })
    }

    case 'compare_ranges': {
      const summary = t('aiToolCompareRanges')
      const info = deps.getActiveSheetInfo()
      const hasHeader = call.input.hasHeader !== false
      type Side = {
        bounds: RangeBounds
        sheetId: string | undefined
        key: number
        columns: number[] | undefined
        label: string
      }
      const parseSide = (prefix: 'left' | 'right'): Side | { error: string } => {
        const raw = call.input[`${prefix}Range`]
        if (typeof raw !== 'string' || !raw.trim())
          return { error: `${prefix}Range must be a non-empty string` }
        let bounds: RangeBounds
        try {
          bounds = parseRange(raw.trim().toUpperCase().replace(/\$/g, ''))
        } catch {
          return { error: `Cannot parse ${prefix}Range: ${raw}` }
        }
        if (hasHeader && bounds.endRow === bounds.startRow) {
          return { error: `${prefix}Range holds only its header row` }
        }
        if (rangeCellCount(bounds) > MAX_SUMMARIZE_CELLS) {
          return {
            error: `${prefix}Range has more than ${MAX_SUMMARIZE_CELLS.toLocaleString('en-US')} cells; compare fewer rows at a time`,
          }
        }
        const inRange = (name: string, value: unknown): number | { error: string } => {
          const index = parseColumnLetter(value)
          if (index === null) return { error: `${name} must be a column letter like "A"` }
          if (index < bounds.startColumn || index > bounds.endColumn) {
            return {
              error: `${name} ${String(value).trim().toUpperCase()} is outside ${prefix}Range ${raw.trim().toUpperCase()}`,
            }
          }
          return index
        }
        const key = inRange(`${prefix}Key`, call.input[`${prefix}Key`])
        if (typeof key !== 'number') return key
        let columns: number[] | undefined
        const columnsRaw = call.input[`${prefix}Columns`]
        if (columnsRaw !== undefined) {
          if (!Array.isArray(columnsRaw) || columnsRaw.length === 0) {
            return { error: `${prefix}Columns must be a non-empty array of column letters` }
          }
          columns = []
          for (const entry of columnsRaw) {
            const column = inRange(`${prefix}Columns`, entry)
            if (typeof column !== 'number') return column
            columns.push(column)
          }
        }
        const parsedSheet = parseReadSheetId(
          { sheetId: call.input[`${prefix}SheetId`] },
          info,
          summary,
        )
        if ('fail' in parsedSheet) return { error: parsedSheet.fail.output }
        const sheetName =
          info.sheets.find((sheet) => sheet.id === (parsedSheet.sheetId ?? info.sheetId))?.name ??
          info.sheetName
        const dataStart = bounds.startRow + (hasHeader ? 1 : 0)
        return {
          bounds,
          sheetId: parsedSheet.sheetId,
          key,
          columns,
          label: `${sheetName}!${formatAddress(dataStart, bounds.startColumn)}:${formatAddress(bounds.endRow, bounds.endColumn)}`,
        }
      }
      const left = parseSide('left')
      if ('error' in left) return fail(summary, left.error)
      const right = parseSide('right')
      if ('error' in right) return fail(summary, right.error)
      if ((left.columns === undefined) !== (right.columns === undefined)) {
        return fail(
          summary,
          'Give leftColumns and rightColumns together (or neither, to pair by header)',
        )
      }
      if (left.columns && right.columns && left.columns.length !== right.columns.length) {
        return fail(summary, 'leftColumns and rightColumns must have the same number of columns')
      }
      if (!hasHeader && !left.columns) {
        return fail(summary, 'Without a header row, give leftColumns and rightColumns to compare')
      }
      if (!deps.collectRows)
        return fail(summary, 'compare_ranges is not available in this context.')
      const toleranceRaw = call.input.tolerance
      const tolerance =
        typeof toleranceRaw === 'number' && Number.isFinite(toleranceRaw) && toleranceRaw > 0
          ? toleranceRaw
          : 0
      const listedRaw = call.input.maxListed
      const maxListed =
        typeof listedRaw === 'number' && Number.isFinite(listedRaw)
          ? Math.min(Math.max(Math.floor(listedRaw), 1), MAX_COMPARE_LISTED)
          : DEFAULT_COMPARE_LISTED
      const hiddenMode = call.input.skipHiddenRows === true ? 'skip' : 'include'
      const includeTotals = call.input.includeTotalRows === true
      const collect = deps.collectRows
      return Promise.all([
        collect(left.sheetId, left.bounds),
        collect(right.sheetId, right.bounds),
      ]).then(([leftRows, rightRows]) => {
        if (!leftRows.ok) return fail(summary, `left: ${leftRows.error}`)
        if (!rightRows.ok) return fail(summary, `right: ${rightRows.error}`)
        const result = reconcileRows({
          left: {
            rows: leftRows.rows,
            startRow: left.bounds.startRow,
            startColumn: left.bounds.startColumn,
            keyColumn: left.key,
          },
          right: {
            rows: rightRows.rows,
            startRow: right.bounds.startRow,
            startColumn: right.bounds.startColumn,
            keyColumn: right.key,
          },
          hasHeader,
          pairs:
            left.columns && right.columns
              ? left.columns.map((column, index): [number, number] => [
                  column,
                  right.columns![index]!,
                ])
              : undefined,
          hiddenRows: hiddenMode,
          totalRows: includeTotals ? 'include' : 'skip',
          tolerance,
        })
        const done = t('aiToolCompareRangesOf', { left: left.label, right: right.label })
        const stale =
          (result.left.cachedFormulaCells > 0 && leftRows.staleInputs === true) ||
          (result.right.cachedFormulaCells > 0 && rightRows.staleInputs === true)
        if (stale) {
          return {
            output:
              `NOT RECALCULATED: keys or compared values in ${left.label} / ${right.label} are formula cells holding the file's cached values ` +
              'from the last save, and cells were edited this session, so the comparison may be out of date — it is withheld. ' +
              'Tell the user it could not be recalculated, or compare ranges without formulas.',
            mutated: false,
            summary: done,
          }
        }
        return {
          output: formatComparison(result, {
            leftLabel: left.label,
            rightLabel: right.label,
            leftKey: left.key,
            rightKey: right.key,
            tolerance,
            hiddenMode,
            includeTotals,
            maxListed,
          }),
          mutated: false,
          summary: done,
        }
      })
    }

    case 'load_guide': {
      const raw = call.input.guides
      if (!Array.isArray(raw) || raw.length === 0)
        return fail(t('aiToolLoadGuide'), 'guides must be a non-empty array')
      const outcome = loadGuides(raw.map(String))
      if (!outcome.ok) return fail(t('aiToolLoadGuide'), outcome.error)
      return {
        output: outcome.content,
        mutated: false,
        summary: t('aiToolLoadGuideOf', { names: raw.join(', ') }),
      }
    }

    case 'read_formats': {
      const raw = call.input.range
      if (typeof raw !== 'string' || !raw.trim())
        return fail(t('aiToolReadFormats'), 'range must be a non-empty string')
      let bounds
      try {
        bounds = parseRange(raw.trim().toUpperCase())
      } catch {
        return fail(t('aiToolReadFormats'), `Cannot parse range: ${raw}`)
      }
      if (rangeCellCount(bounds) > MAX_READ_FORMAT_CELLS) {
        return fail(
          t('aiToolReadFormats'),
          `The range contains more than ${MAX_READ_FORMAT_CELLS} cells; read it in multiple calls`,
        )
      }
      const info = deps.getActiveSheetInfo()
      const parsedSheet = parseReadSheetId(call.input, info, t('aiToolReadFormats'))
      if ('fail' in parsedSheet) return parsedSheet.fail
      const sheetId = parsedSheet.sheetId
      const executeRead = (): ToolExecution => {
        const addresses: string[] = []
        for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
          for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
            addresses.push(formatAddress(row, column))
          }
        }
        const formats = deps.readFormats(addresses, sheetId)
        const lines = Object.entries(formats).map(
          ([address, format]) => `${address}: ${describeFormatState(format)}`,
        )
        return {
          output: lines.length > 0 ? lines.join('\n') : 'No explicit formats in this range.',
          mutated: false,
          summary: t('aiToolReadFormatsOf', { range: raw.trim().toUpperCase() }),
        }
      }
      const target = info.sheets.find((sheet) => sheet.id === (sheetId ?? info.sheetId))
      const ensureBounds = clampToExtent(bounds, target)
      const loading = ensureBounds ? deps.ensureRangeLoaded?.(ensureBounds, sheetId) : true
      if (loading instanceof Promise) {
        return loading.then((loaded) =>
          loaded ? executeRead() : fail(t('aiToolReadFormats'), RANGE_NOT_LOADED),
        )
      }
      if (loading === false) return fail(t('aiToolReadFormats'), RANGE_NOT_LOADED)
      return executeRead()
    }

    case 'read_sheet_features': {
      const info = deps.getActiveSheetInfo()
      const parsedSheet = parseReadSheetId(call.input, info, t('aiToolSheetFeatures'))
      if ('fail' in parsedSheet) return parsedSheet.fail
      const sheetId = parsedSheet.sheetId
      const executeRead = (): ToolExecution => ({
        output: deps.readSheetFeatures(sheetId),
        mutated: false,
        summary: t('aiToolSheetFeatures'),
      })
      // Filter/CF/validation/freeze models install on a sheet's first
      // stream-in; reading a never-loaded sheet would report false "none"s.
      const loading = deps.ensureRangeLoaded?.(
        { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
        sheetId,
      )
      if (loading instanceof Promise) {
        return loading.then((loaded) =>
          loaded ? executeRead() : fail(t('aiToolSheetFeatures'), RANGE_NOT_LOADED),
        )
      }
      if (loading === false) return fail(t('aiToolSheetFeatures'), RANGE_NOT_LOADED)
      return executeRead()
    }

    case 'read_cells': {
      const raw = call.input.addresses
      if (!Array.isArray(raw) || raw.length === 0)
        return fail(t('aiToolReadCells'), 'addresses must be a non-empty array')
      const info = deps.getActiveSheetInfo()
      const parsedSheet = parseReadSheetId(call.input, info, t('aiToolReadCells'))
      if ('fail' in parsedSheet) return parsedSheet.fail
      const sheetId = parsedSheet.sheetId
      const addresses = raw.slice(0, MAX_READ_ADDRESSES).map(String)
      // Past the cap the rest is dropped; say so, or the model answers from a
      // partial read believing it saw everything.
      const unread = raw.length - addresses.length
      const executeRead = (): ToolExecution => {
        const cells = deps.readCells(addresses, sheetId)
        const lines = addresses.map((addr) => {
          const cell = cells[addr]
          if (!cell) return `${addr}: (unknown)`
          const { text, notes } = describeReadCell(cell)
          return `${addr}: ${text}${notes.length > 0 ? ` [${notes.join('; ')}]` : ''}`
        })
        if (unread > 0) {
          lines.unshift(
            `Note: ${raw.length} addresses were requested but only the first ${MAX_READ_ADDRESSES} were read ` +
              `(max ${MAX_READ_ADDRESSES} per call); the remaining ${unread} were NOT read, starting at ` +
              `${String(raw[MAX_READ_ADDRESSES])}. To get them, call read_cells again with the remaining ` +
              'addresses, or use read_range / aggregate_range for contiguous blocks.',
          )
        }
        return {
          output: lines.join('\n'),
          mutated: false,
          summary: t('aiToolReadCellsCount', { count: addresses.length }),
        }
      }
      const ensure = deps.ensureRangeLoaded
      if (!ensure) return executeRead()
      // Unstreamed cells read as empty, so the covering box of the addresses
      // is loaded first. Per-address fallback loads are NOT an option: the
      // loaded-range bookkeeping is a single rectangle per sheet, so each
      // load would evict the previous one and just-read cells would drop out
      // of the editable region again.
      let box: RangeBounds | null = null
      for (const addr of addresses) {
        let cell: RangeBounds
        try {
          cell = parseRange(addr.trim().toUpperCase())
        } catch {
          continue
        }
        box =
          box === null
            ? cell
            : {
                startRow: Math.min(box.startRow, cell.startRow),
                endRow: Math.max(box.endRow, cell.endRow),
                startColumn: Math.min(box.startColumn, cell.startColumn),
                endColumn: Math.max(box.endColumn, cell.endColumn),
              }
      }
      const target = info.sheets.find((sheet) => sheet.id === (sheetId ?? info.sheetId))
      const boundsBox = box === null ? null : clampToExtent(box, target)
      if (boundsBox === null) return executeRead()
      // Whether the box needs streaming at all (demo workbook, fully preloaded
      // import, session-added sheet) is the callback's call — it also rejects
      // boxes too large to stream as one block.
      return (async (): Promise<ToolExecution> => {
        if (!(await ensure(boundsBox, sheetId))) {
          return fail(
            t('aiToolReadCells'),
            'The requested cells could not be fully loaded — retry after workbook indexing completes; ' +
              `on streamed workbooks a scatter spanning more than ${MAX_READ_RANGE_CELLS} cells must be split into closer-together read_cells calls.`,
          )
        }
        return executeRead()
      })()
    }

    case 'find_cells': {
      const errorsOnly = call.input.errors_only === true
      const query = typeof call.input.query === 'string' ? call.input.query.trim() : ''
      if (!errorsOnly && !query) {
        return fail(
          t('aiToolFindCells'),
          'query must be a non-empty string (or set errors_only=true)',
        )
      }
      const lookInRaw = call.input.look_in
      const maxRaw = Number(call.input.max_results)
      const sheetIdRaw = call.input.sheetId
      const options: FindCellsOptions = {
        query,
        regex: call.input.regex === true,
        lookIn: lookInRaw === 'values' || lookInRaw === 'formulas' ? lookInRaw : 'both',
        errorsOnly,
        sheetId:
          typeof sheetIdRaw === 'string' && sheetIdRaw.trim() ? sheetIdRaw.trim() : undefined,
        maxResults:
          Number.isFinite(maxRaw) && maxRaw >= 1
            ? Math.min(Math.floor(maxRaw), MAX_FIND_RESULTS)
            : DEFAULT_FIND_RESULTS,
      }
      const finish = (result: FindCellsOutcome): ToolExecution => {
        if (result.error) return fail(t('aiToolFindCells'), result.error)
        const lines = result.matches.map(
          (match) => `${match.sheetName}!${match.address}: ${formatCellScalar(match)}`,
        )
        const header =
          result.matches.length === 0
            ? result.truncated
              ? 'No matching cells found in the scanned region, but the search stopped at the scan budget before covering the whole workbook — do NOT conclude there are no matches; narrow the query or scope with sheetId and retry.'
              : 'No matching cells found.'
            : `${result.matches.length} matching cell(s)` +
              (result.truncated
                ? ' (search stopped at the cap — more may exist; narrow the query or scope with sheetId):'
                : ':')
        if (result.incompleteSheets.length > 0) {
          lines.push(
            `Note: background indexing has not finished on ${result.incompleteSheets.join(', ')} — matches there may be missing; retry later if something expected is absent.`,
          )
        }
        return {
          output: [header, ...lines].join('\n'),
          mutated: false,
          summary: errorsOnly
            ? t('aiToolFindErrors', { count: result.matches.length })
            : t('aiToolFindCellsOf', { query, count: result.matches.length }),
        }
      }
      const outcome = deps.findCells(options)
      return outcome instanceof Promise ? outcome.then(finish) : finish(outcome)
    }

    case 'select_range': {
      const raw = call.input.range
      if (typeof raw !== 'string' || !raw.trim())
        return fail(t('aiToolSelectRange'), 'range must be a non-empty string')
      let bounds: RangeBounds
      try {
        bounds = parseRange(raw.trim().toUpperCase().replace(/\$/g, ''))
      } catch {
        return fail(t('aiToolSelectRange'), `Cannot parse range: ${raw}`)
      }
      const sheetIdRaw = call.input.sheetId
      const sheetId =
        typeof sheetIdRaw === 'string' && sheetIdRaw.trim() ? sheetIdRaw.trim() : undefined
      const normalized =
        bounds.startRow === bounds.endRow && bounds.startColumn === bounds.endColumn
          ? formatAddress(bounds.startRow, bounds.startColumn)
          : `${formatAddress(bounds.startRow, bounds.startColumn)}:${formatAddress(bounds.endRow, bounds.endColumn)}`
      const finish = (result: SelectRangeOutcome): ToolExecution => {
        if (!result.ok) return fail(t('aiToolSelectRange'), result.error ?? 'Selection failed')
        const label = `${result.sheetName ?? ''}!${normalized}`
        return {
          output: `Selected ${label} and scrolled it into view.`,
          mutated: false,
          summary: t('aiToolSelectRangeOf', { range: label }),
        }
      }
      const outcome = deps.selectRange(sheetId, bounds)
      return outcome instanceof Promise ? outcome.then(finish) : finish(outcome)
    }

    case 'trace_precedents': {
      const parsed = parseAuditAddress(call.input, t('aiToolTracePrecedents'))
      if ('fail' in parsed) return parsed.fail
      const finish = (result: TracePrecedentsOutcome): ToolExecution => {
        if (result.error) return fail(t('aiToolTracePrecedents'), result.error)
        const summary = t('aiToolTracePrecedentsOf', { address: parsed.address })
        if (!result.formula) {
          return {
            output: `${parsed.address} is not a formula cell; value: ${formatCellScalar({ value: result.value ?? null })}. Nothing to trace upstream — use trace_dependents to see what reads it.`,
            mutated: false,
            summary,
          }
        }
        const lines = [
          `${parsed.address} = ${formatCellScalar({ value: result.value ?? null, formula: result.formula })}`,
          `Reads ${result.refs.length}${result.truncatedRefs ? '+' : ''} reference(s):`,
        ]
        for (const ref of result.refs) {
          if (ref.external) {
            lines.push(
              `- ${ref.label}: external/unresolved reference (another workbook or unknown sheet)`,
            )
            continue
          }
          const shown = ref.samples
            .map((sample) => `${sample.address}=${formatCellScalar(sample)}`)
            .join('; ')
          const rest = ref.cellCount - ref.samples.length
          lines.push(
            `- ${ref.label} (${ref.cellCount} cell(s))${ref.hasError ? ' ⚠️ contains error values' : ''}: ${shown}${rest > 0 ? `; …${rest} more` : ''}`,
          )
        }
        if (result.truncatedRefs) {
          lines.push('Note: the formula has more references than shown here.')
        }
        if (result.usesNames) {
          lines.push(
            'Note: the formula also uses defined names — list them with read_sheet_features and trace their ranges directly.',
          )
        }
        return { output: lines.join('\n'), mutated: false, summary }
      }
      const outcome = deps.tracePrecedents(parsed.sheetId, parsed.address)
      return outcome instanceof Promise ? outcome.then(finish) : finish(outcome)
    }

    case 'trace_dependents': {
      const parsed = parseAuditAddress(call.input, t('aiToolTraceDependents'))
      if ('fail' in parsed) return parsed.fail
      const finish = (result: TraceDependentsOutcome): ToolExecution => {
        if (result.error) return fail(t('aiToolTraceDependents'), result.error)
        const summary = t('aiToolTraceDependentsOf', {
          address: parsed.address,
          count: result.dependents.length,
        })
        const lines =
          result.dependents.length === 0
            ? [
                `No formulas read ${parsed.address}. (Dependents that reach it only through a defined name are not detected.)`,
              ]
            : [
                `${result.dependents.length}${result.truncated ? '+' : ''} formula cell(s) read ${parsed.address}:`,
                ...result.dependents.map(
                  (dep) =>
                    `- ${dep.sheetName}!${dep.address} = ${formatCellScalar({ value: dep.value, formula: dep.formula })}`,
                ),
              ]
        if (result.truncated) {
          lines.push('Note: stopped at the result cap — more dependents exist.')
        }
        if (result.incompleteSheets.length > 0) {
          lines.push(
            `Note: background indexing has not finished on ${result.incompleteSheets.join(', ')} — dependents there may be missing.`,
          )
        }
        return { output: lines.join('\n'), mutated: false, summary }
      }
      const outcome = deps.traceDependents(parsed.sheetId, parsed.address)
      return outcome instanceof Promise ? outcome.then(finish) : finish(outcome)
    }

    case 'propose_operations': {
      const rawOps = call.input.operations
      const summaryInput = call.input.summary
      if (!Array.isArray(rawOps) || rawOps.length === 0) {
        return fail(t('aiToolPropose'), 'operations must be a non-empty array')
      }
      if (typeof summaryInput !== 'string' || !summaryInput.trim()) {
        return fail(t('aiToolPropose'), 'summary must not be empty')
      }
      const parsedOps = z.array(workbookOperationSchema).safeParse(rawOps)
      if (!parsedOps.success) {
        return fail(t('aiToolPropose'), describeOperationErrors(rawOps, parsedOps.error))
      }
      const operations: WorkbookOperation[] = parsedOps.data
      const outcome = deps.proposeOperations(operations, summaryInput.trim())
      if (!outcome.ok) {
        return fail(
          t('aiToolPropose'),
          `Rejected — none of the ${operations.length} operation(s) were applied (a batch is all-or-nothing): ${outcome.error}`,
        )
      }
      const summary = summaryInput.trim()
      const finish = (
        appliedNotices: readonly string[] = [],
      ): ToolExecution | Promise<ToolExecution> => {
        const notes = [...outcome.plan.warnings, ...appliedNotices]
        const warnings = notes.length > 0 ? `\nNote: ${notes.join('; ')}` : ''
        const opCount =
          outcome.plan.cellChanges.length +
          outcome.plan.formatChanges.length +
          outcome.plan.sheetRenames.length +
          outcome.plan.structuralChanges.length
        const base = `Auto-applied ${opCount} change(s) (undo via the side panel [Undo] button or ⌘Z): ${formatPlanSummary(outcome.plan)}${warnings}`
        // Read-back after write (write → verify): formula cells fetch their
        // computed values after the async recalc, so the AI sees real results and
        // errors like #REF!/#DIV/0! instead of just what it wrote.
        const formulaCells: { sheetId: string; address: string }[] = outcome.plan.cellChanges
          .filter((c) => c.after.formula)
          .map((c) => ({ sheetId: c.sheetId, address: c.address }))
        // fill_range / copy_range apply as range-level bulk writes (no
        // per-cell plan entries), so read back each target's corners to
        // confirm the write actually landed and its shifted formulas compute.
        for (const op of operations) {
          if (op.op !== 'fill_range' && op.op !== 'copy_range') continue
          const bounds = op.op === 'fill_range' ? parseRange(op.target) : copyTargetBounds(op)
          const first = formatAddress(bounds.startRow, bounds.startColumn)
          formulaCells.push({ sheetId: op.sheetId, address: first })
          // A filtered copy's real extent is smaller than the worst-case
          // bounds (and it writes no formulas) — read back only the anchor.
          if (op.op === 'copy_range' && op.filterColumn !== undefined) continue
          const last = formatAddress(bounds.endRow, bounds.endColumn)
          if (last !== first) formulaCells.push({ sheetId: op.sheetId, address: last })
        }
        if (formulaCells.length === 0) {
          return { output: base, mutated: true, summary }
        }
        return (async (): Promise<ToolExecution> => {
          await new Promise((resolve) => setTimeout(resolve, FORMULA_RECALC_DELAY_MS))
          const shown = formulaCells.slice(0, MAX_READBACK_FORMULAS)
          // Cells are read per target sheet (operations may span sheets);
          // addresses are prefixed with the sheet name only when they do.
          const bySheet = new Map<string, string[]>()
          for (const cell of shown) {
            bySheet.set(cell.sheetId, [...(bySheet.get(cell.sheetId) ?? []), cell.address])
          }
          const sheetNames = new Map(
            deps.getActiveSheetInfo().sheets.map((sheet) => [sheet.id, sheet.name]),
          )
          const lines: string[] = []
          for (const [cellSheetId, addresses] of bySheet) {
            const cells = deps.readCells(addresses, cellSheetId)
            const prefix = bySheet.size > 1 ? `${sheetNames.get(cellSheetId) ?? cellSheetId}!` : ''
            for (const addr of addresses) {
              const cell = cells[addr]
              const v = cell?.value
              const unsupported = cell ? unsupportedNote(cell) : null
              lines.push(
                `${prefix}${addr} = ${v === null || v === undefined ? (unsupported ? '(no result)' : '(still computing; verify with read_cells)') : String(v)}` +
                  (unsupported ? ` (${unsupported})` : ''),
              )
            }
          }
          const rest = formulaCells.length - shown.length
          const hasError = lines.some((l) =>
            /#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/.test(l),
          )
          return {
            output:
              `${base}\nFormula results: ${lines.join('; ')}${rest > 0 ? `; …${rest} more formula cells` : ''}` +
              (hasError
                ? '\n⚠️ Formula error values present — check references/divisors and fix them.'
                : ''),
            mutated: true,
            summary,
          }
        })()
      }
      if (!outcome.applied) return finish()
      return outcome.applied.then((applied) => {
        if (applied.ok) return finish(applied.notices)
        const reason = applied.reason ?? 'unknown reason'
        return fail(
          t('aiToolPropose'),
          applied.partiallyApplied
            ? `Apply failed MID-BATCH — operations before the failing one were already committed: ${reason}. ` +
                'Read the affected ranges to see the current state before continuing; ' +
                (applied.undoDropped
                  ? 'the committed part is too large for the undo history — ⌘Z will NOT revert it.'
                  : 'the whole partial batch is one undo step (⌘Z / [Undo]).')
            : `Apply failed — the workbook is UNCHANGED: ${reason}. ` +
                'Do not tell the user the changes were made; adjust the operations and retry, or explain the failure.',
        )
      })
    }

    case 'create_document': {
      const summary = t('aiToolCreateDocument')
      const create = deps.createDocument
      // the tool is not offered without the `createDocument` capability (web); a stray call fails typed
      if (!create || !cap('createDocument')) {
        return fail(summary, 'create_document is not available in this context.')
      }
      const typeRaw = call.input.type === undefined ? 'xlsx' : String(call.input.type)
      if (
        typeRaw !== 'xlsx' &&
        typeRaw !== 'csv' &&
        typeRaw !== 'docx' &&
        typeRaw !== 'pdf' &&
        typeRaw !== 'md' &&
        typeRaw !== 'html'
      ) {
        return fail(summary, 'type must be one of xlsx/csv/docx/pdf/md/html')
      }
      const title = typeof call.input.title === 'string' ? call.input.title.trim() : ''
      if (typeRaw === 'xlsx' || typeRaw === 'csv') {
        if (typeof call.input.content === 'string' && call.input.content.trim() !== '') {
          return fail(
            summary,
            'content is forbidden for xlsx/csv — they export a worksheet. To create a file from new data, ' +
              'write it into a sheet first (add_sheet + set_range via propose_operations), then export that sheet.',
          )
        }
        const parsedSheet = parseReadSheetId(call.input, deps.getActiveSheetInfo(), summary)
        if ('fail' in parsedSheet) return parsedSheet.fail
        return create({
          type: typeRaw,
          sheetId: parsedSheet.sheetId,
          ...(title ? { title } : {}),
        }).then((outcome) => {
          if (!outcome.ok) return fail(summary, outcome.error)
          const note = outcome.hadFormulas
            ? ' Note: the sheet contains formulas — the new file holds their current computed values only (no formulas or formatting).'
            : ''
          return {
            output:
              `Created ${outcome.name}${outcome.path ? ` at ${outcome.path}` : ''} from sheet ` +
              `"${outcome.sheetName ?? ''}" and opened it in a new tab. The current workbook is unchanged.${note}`,
            mutated: false,
            summary: t('aiToolCreatedDocument', { name: outcome.name }),
          }
        })
      }
      if (!title) return fail(summary, 'title must not be empty')
      const content = String(call.input.content ?? '')
      if (!content.trim()) return fail(summary, 'content must not be empty')
      if (typeRaw !== 'md') {
        const echo = contentEchoError(content)
        if (echo) return fail(summary, echo)
      }
      return create({ type: typeRaw, title, content }).then((outcome) => {
        if (!outcome.ok) return fail(summary, outcome.error)
        return {
          output: outcome.path
            ? `Created the new document at ${outcome.path} and opened it in a new tab.`
            : `Created the new document "${outcome.name}" in a new tab; it saves itself into the default folder.`,
          mutated: false,
          summary: t('aiToolCreatedDocument', { name: outcome.name }),
        }
      })
    }

    default:
      return fail(call.name, `Unknown tool: ${call.name}`)
  }
}
