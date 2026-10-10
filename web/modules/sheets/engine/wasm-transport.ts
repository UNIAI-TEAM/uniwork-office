/**
 * The WASM engine behind the Sheets seam (UNI-1016, GO-D3 = C / CONTRACT C11).
 *
 * `SheetsEngineTransport` over the xlsx-sidecar wasm reactor (./host.ts) reached through an
 * EngineChannel (a module Worker in the frame, ./engine.worker.ts). It also carries what the
 * Electron main process does around the desktop sidecar (apps/sheets/src/main/sheets-main.ts):
 *   - the session map (sheet id -> file sheet name, the session's bytes as the save base),
 *   - `.xls` -> `.xlsx` through `convert_workbook` before the open (the session then needs
 *     Save As, as on the desktop),
 *   - the WorkbookFile the renderer expects (sha256 of the bytes, size, recovery policy),
 *   - pivot definitions (`read_entries` x2 + the gateway's parser),
 *   - save = the gateway planner + `save_archive` (./save-plan.ts), then a session swap onto the
 *     saved bytes (`replaceSession`).
 * Frame-side size gate (C11): after `archive_manifest`, more than MAX_WORKSHEET_XML_BYTES of
 * uncompressed worksheet XML refuses the open with `too_large` (the host opens G3 instead).
 * Recalc fallback stays off on the web (C11) as a UI operation, so `features.recalcFallback` is false;
 * the engine's `recalc_cells` still runs inside a save, to write cached values for the formulas the
 * user typed (./cached-values.ts).
 * Crash recovery (SH3): a Rust panic aborts the wasm instance and every session in it. The
 * transport keeps each session's last saved bytes, starts a fresh engine and reopens the sessions
 * from those bytes under the same renderer-facing session ids, then tells the host through
 * `onRecovered` (the frame shows a typed notice). The renderer's edit journal lives outside the
 * engine, so unsaved edits are still saved into the reopened session.
 */
import {
  workbookFileSchema,
  workbookFindCellsResultSchema,
  workbookFormulaCellsResultSchema,
  workbookMediaResultSchema,
  workbookPivotDefinitionSchema,
  workbookRangeResultSchema,
  workbookRowOutlineResultSchema,
  type WorkbookFile,
  type WorkbookSaveRequest,
} from '../../../../apps/sheets/src/shared/desktop-api'
import { allowsAutomaticWorkbookRecovery } from '../../../../apps/sheets/src/main/recovery-policy'
import { parsePivotDefinition } from '../../../../packages/xlsx-gateway/src/gateway/xlsx-pivot'
import type { ArchiveEntry } from '../../../../packages/xlsx-gateway/src/gateway/xlsx-package-io'
import type { EngineChannel, EngineResponse } from './channel'
import { blankWorkbook } from './blank'
import { WORK_DIR } from './host'
// the save planner (the gateway, most of this module's weight) loads on the first save
import type { ArchiveEngine } from './save-plan'
import { planCachedValues, toFormulaValues } from './cached-values'
import type { EngineOpenInput, SheetsEngineTransport } from './transport'

/**
 * Uncompressed xl/worksheets/*.xml above this opens in G3 instead (C11; lead-confirmed
 * 2026-10-09). Measured with the incremental index: 2.2M dense cells = 70.8 MB of worksheet XML
 * open + first viewport in ~2.3 s, renderer peak ~0.8 GB; at 4.4M cells (145 MB) the first paint
 * is ~4 s and the renderer passes 1.3 GB. Host-side counterpart: 10 MB stored file size.
 */
export const MAX_WORKSHEET_XML_BYTES = 80 * 1024 * 1024

export const TOO_LARGE = 'too_large'

/** the workbook is above the frame's size gate; the host falls back to the G3 editor */
export class SheetsTooLargeError extends Error {
  readonly code = TOO_LARGE
  constructor(readonly worksheetXmlBytes: number) {
    super(
      `${TOO_LARGE}: ${Math.round(worksheetXmlBytes / 1048576)} MB of worksheet XML is above the web limit of ` +
        `${MAX_WORKSHEET_XML_BYTES / 1048576} MB`,
    )
    this.name = 'SheetsTooLargeError'
  }
}

const sidecarOpenResultSchema = workbookFileSchema.omit({ sha256: true, readOnly: true })

interface Session {
  /** engine path of the session's workbook */
  path: string
  /** the last opened or saved bytes: the save base, and what a crashed engine reopens from */
  bytes: Uint8Array
  sheetNames: Map<string, string>
  /** the engine's own id for the session; changes when a crash recovery reopens it */
  engineId: string
  /** the formula engine crashed on this workbook: saves skip the cached-value recalc */
  recalcCrashed?: boolean
  /** the open parameters a recovery repeats */
  locale: string
  shortDateFormat?: string
}

/** an engine crash was recovered: the sessions were reopened from their last saved bytes */
export interface EngineRecovery {
  type: 'engine-recovered'
  /** the command that was running when the engine stopped */
  command: string
  /** sessions that were open, and how many of them came back */
  sessions: number
  reopened: number
}

/** commands that only read a session: safe to run again once the session is back */
const IDEMPOTENT_READS = new Set([
  'read_range',
  'read_formula_cells',
  'find_cells',
  'read_row_outline',
  'read_media',
])

let counter = 0
const uid = () => `${Date.now().toString(36)}-${(++counter).toString(36)}`

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function engineError(response: EngineResponse, operation: string): Error {
  const error = response.error ?? { code: 'internal', message: `${operation} failed` }
  return Object.assign(new Error(error.message), { code: error.code })
}

/** sum of the uncompressed worksheet parts (what the index and the planner materialize) */
export function worksheetXmlBytes(entries: readonly ArchiveEntry[]): number {
  return entries
    .filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name))
    .reduce((sum, entry) => sum + entry.uncompressedSize, 0)
}

export interface WasmTransportOptions {
  /** a fresh channel to a fresh engine (called again after the engine crashed) */
  connect: () => EngineChannel
  maxWorksheetXmlBytes?: number
  /** called after a crash, once the open workbooks are reopened in a fresh engine */
  onRecovered?: (recovery: EngineRecovery) => void
}

export function createWasmTransport(options: WasmTransportOptions): SheetsEngineTransport & {
  /** diagnostics: wasm memory and the engine's stderr tail */
  stats(): Promise<{ memoryBytes: number; stderr: string[] }>
} {
  const maxXml = options.maxWorksheetXmlBytes ?? MAX_WORKSHEET_XML_BYTES
  let channel: EngineChannel | null = null
  const sessions = new Map<string, Session>()
  const ch = () => (channel ??= options.connect())

  /** true while `recover` reopens sessions (its own engine calls must not wait on itself) */
  let recovering = false
  /** the one recovery in flight: concurrent calls that hit the same crash share it */
  let recoveryRun: Promise<void> | null = null

  /** one engine command; a renderer-facing `sessionId` is swapped for the engine's own id */
  async function call(command: string, payload: Record<string, unknown>): Promise<unknown> {
    const retry = IDEMPOTENT_READS.has(command)
    for (let attempt = 0; ; attempt += 1) {
      // the recovery's own commands (`nested`) must not wait on the recovery they belong to
      const nested = recovering
      if (recoveryRun && !nested) await recoveryRun
      const sessionId = payload.sessionId
      const engineId =
        typeof sessionId === 'string' ? (sessions.get(sessionId)?.engineId ?? sessionId) : undefined
      const body = engineId === undefined ? payload : { ...payload, sessionId: engineId }
      const requestId = `${command}-${uid()}`
      const line = JSON.stringify({ version: 1, requestId, command, ...body })
      const used = ch()
      let response: EngineResponse
      try {
        response = await used.request(line, requestId)
      } catch (err) {
        if ((err as { code?: string }).code !== 'engine_crashed') throw err
        // a trapped engine lost every session: start a fresh one and reopen them
        if (used === channel) {
          used.dispose()
          channel = null
          if (!nested) {
            recoveryRun = recover(command).finally(() => {
              recoveryRun = null
            })
          }
        }
        if (nested) throw err
        await recoveryRun
        // a read is repeated once against the reopened session; anything else reports the crash
        // (the next call works: the session is back)
        if (retry && attempt === 0 && typeof sessionId === 'string' && sessions.has(sessionId)) {
          continue
        }
        throw err
      }
      if (!response.ok) throw engineError(response, command)
      return response.result
    }
  }

  /** reopen every session of a crashed engine from its last saved bytes, then tell the host */
  async function recover(command: string): Promise<void> {
    const lost = [...sessions]
    recovering = true
    let reopened = 0
    try {
      for (const [id, s] of lost) {
        try {
          await archive.writeFile(s.path, s.bytes)
          const opened = sidecarOpenResultSchema.parse(
            await call('open', {
              path: s.path,
              locale: s.locale,
              ...(s.shortDateFormat ? { shortDateFormat: s.shortDateFormat } : {}),
            }),
          )
          s.engineId = opened.sessionId
          s.sheetNames = new Map(opened.sheets.map((sheet) => [sheet.id, sheet.name]))
          reopened += 1
        } catch {
          // a workbook that cannot come back (or crashes the engine again) is dropped
          sessions.delete(id)
          if (channel === null) break
        }
      }
    } finally {
      recovering = false
    }
    if (channel === null) sessions.clear()
    options.onRecovered?.({ type: 'engine-recovered', command, sessions: lost.length, reopened })
  }

  const archive: ArchiveEngine = {
    manifest: async (path) =>
      ((await call('archive_manifest', { path })) as { entries: ArchiveEntry[] }).entries,
    writeFile: (path, data) =>
      ch().writeFile(
        path,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      ),
    readFile: async (path) => new Uint8Array(await ch().readFile(path)),
    // cleanup never starts an engine (after a crash the files are gone with it)
    remove: (path) => channel?.remove(path) ?? Promise.resolve(),
    saveArchive: async (input) =>
      (await call('save_archive', input)) as {
        beforeEntries: ArchiveEntry[]
        afterEntries: ArchiveEntry[]
      },
  }

  function session(sessionId: string): Session {
    const s = sessions.get(sessionId)
    if (!s) throw new Error('Unknown workbook session.')
    return s
  }

  async function open(input: EngineOpenInput): Promise<WorkbookFile> {
    const legacy = /\.xls$/i.test(input.name)
    const ext = /\.xlsm$/i.test(input.name) ? 'xlsm' : 'xlsx'
    const id = uid()
    const path = `${WORK_DIR}/${id}.${ext}`
    let bytes: Uint8Array = new Uint8Array(input.data)
    // an empty document (the host's "new spreadsheet") opens as a blank workbook, as on the desktop
    if (bytes.byteLength === 0 && !legacy) bytes = await blankWorkbook()
    if (legacy) {
      const sourcePath = `${WORK_DIR}/${id}.xls`
      await archive.writeFile(sourcePath, bytes)
      try {
        await call('convert_workbook', { path: sourcePath, targetPath: path })
      } finally {
        await archive.remove(sourcePath).catch(() => {})
      }
      bytes = await archive.readFile(path)
    } else {
      await archive.writeFile(path, bytes)
    }
    try {
      const xml = worksheetXmlBytes(await archive.manifest(path))
      if (xml > maxXml) throw new SheetsTooLargeError(xml)
      const opened = sidecarOpenResultSchema.parse(
        await call('open', {
          path,
          locale: input.locale,
          ...(input.shortDateFormat ? { shortDateFormat: input.shortDateFormat } : {}),
        }),
      )
      sessions.set(opened.sessionId, {
        path,
        bytes,
        sheetNames: new Map(opened.sheets.map((sheet) => [sheet.id, sheet.name])),
        engineId: opened.sessionId,
        locale: input.locale,
        ...(input.shortDateFormat ? { shortDateFormat: input.shortDateFormat } : {}),
      })
      return workbookFileSchema.parse({
        ...opened,
        sha256: await sha256Hex(bytes),
        fileBytes: bytes.byteLength,
        readOnly: false,
        needsSaveAs: legacy,
        restoredFromRecovery: false,
        automaticRecoveryDisabled: !allowsAutomaticWorkbookRecovery(opened.sheets),
      })
    } catch (err) {
      await archive.remove(path).catch(() => {})
      throw err
    }
  }

  async function close(sessionId: string): Promise<void> {
    const s = sessions.get(sessionId)
    if (!s) return
    sessions.delete(sessionId)
    try {
      await call('close', { sessionId: s.engineId })
    } finally {
      await archive.remove(s.path).catch(() => {})
    }
  }

  /**
   * The save request with a cached value for every formula the user typed (SH3): the engine's
   * `recalc_cells` evaluates the session's pending edits and the typed cells' results go in as
   * `formulaValues`, so the reopened workbook shows them before Univer's closure covers the
   * cell. Fail-soft: a recalc that cannot run saves the formulas without cached values.
   */
  async function withCachedValues(
    request: WorkbookSaveRequest,
    s: Session,
  ): Promise<WorkbookSaveRequest> {
    if (s.recalcCrashed) return request
    const planned = planCachedValues(request, s.sheetNames, s.bytes.byteLength)
    if (!planned) return request
    try {
      const result = (await call('recalc_cells', {
        path: s.path,
        edits: planned.edits,
        reads: planned.reads,
      })) as { cells: Parameters<typeof toFormulaValues>[0] }
      const values = toFormulaValues(result.cells, s.sheetNames)
      return values.length === 0
        ? request
        : { ...request, formulaValues: [...request.formulaValues, ...values] }
    } catch (err) {
      // IronCalc's strict importer can panic on a workbook from a non-Excel producer, and a panic
      // aborts the wasm instance (no unwinding). `call` already reopened the sessions; the save
      // goes on without cached values, and this session never asks the formula engine again
      if ((err as { code?: string }).code === 'engine_crashed') s.recalcCrashed = true
      return request
    }
  }

  return {
    kind: 'wasm',
    // C11: open/read/formulas/media/pivot/save/.xls convert on; recalc fallback stays hidden
    features: Object.freeze({ xlsImport: true, pivotRefresh: true, recalcFallback: false }),
    open,
    async readRange(request) {
      session(request.sessionId)
      return workbookRangeResultSchema.parse(await call('read_range', request))
    },
    async readFormulaCells(request) {
      session(request.sessionId)
      return workbookFormulaCellsResultSchema.parse(await call('read_formula_cells', request))
    },
    async findCells(request) {
      session(request.sessionId)
      return workbookFindCellsResultSchema.parse(await call('find_cells', request))
    },
    async readRowOutline(request) {
      session(request.sessionId)
      return workbookRowOutlineResultSchema.parse(await call('read_row_outline', request))
    },
    async readMedia(request) {
      session(request.sessionId)
      return workbookMediaResultSchema.parse(await call('read_media', request))
    },
    async readPivotDefinition(request) {
      const s = session(request.sessionId)
      const outputDir = `${WORK_DIR}/pivot-${uid()}`
      const extracted = (await call('read_entries', {
        path: s.path,
        entries: [request.path, request.cachePath],
        outputDir,
      })) as { entries: { name: string; path: string }[] }
      const text = async (name: string) => {
        const entry = extracted.entries.find((e) => e.name === name)
        if (!entry) throw new Error(`Workbook is missing ${name}.`)
        const bytes = await archive.readFile(entry.path)
        await archive.remove(entry.path).catch(() => {})
        return new TextDecoder().decode(bytes)
      }
      const [pivotXml, cacheXml] = [await text(request.path), await text(request.cachePath)]
      return workbookPivotDefinitionSchema.parse(parsePivotDefinition(pivotXml, cacheXml))
    },
    recalc: () => Promise.reject(new Error('recalculation fallback is not available on the web')),
    async serialize(request) {
      const s = session(request.sessionId)
      const { resolveSaveRequest, saveWorkbookBytes } = await import('./save-plan')
      const { data, plan } = await saveWorkbookBytes({
        engine: archive,
        sourcePath: s.path,
        sourceBytes: s.bytes,
        workDir: `${WORK_DIR}/save-${uid()}`,
        save: resolveSaveRequest(s.sheetNames, await withCachedValues(request, s)),
      })
      return {
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
        touchedEntries: [...plan.touchedEntries],
      }
    },
    async replaceSession(input) {
      await close(input.sessionId)
      return open(input)
    },
    close,
    stats: () => ch().stats(),
    dispose() {
      channel?.dispose()
      channel = null
      sessions.clear()
    },
  }
}
