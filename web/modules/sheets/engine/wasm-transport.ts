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
 * Recalc fallback stays off on the web (C11), so `features.recalcFallback` is false.
 */
import {
  workbookFileSchema,
  workbookFormulaCellsResultSchema,
  workbookMediaResultSchema,
  workbookPivotDefinitionSchema,
  workbookRangeResultSchema,
  type WorkbookFile,
} from '../../../../apps/sheets/src/shared/desktop-api'
import { allowsAutomaticWorkbookRecovery } from '../../../../apps/sheets/src/main/recovery-policy'
import { parsePivotDefinition } from '../../../../packages/xlsx-gateway/src/gateway/xlsx-pivot'
import type { ArchiveEntry } from '../../../../packages/xlsx-gateway/src/gateway/xlsx-package-io'
import type { EngineChannel, EngineResponse } from './channel'
import { blankWorkbook } from './blank'
import { WORK_DIR } from './host'
import { resolveSaveRequest, saveWorkbookBytes, type ArchiveEngine } from './save-plan'
import type { EngineOpenInput, SheetsEngineTransport } from './transport'

/** uncompressed xl/worksheets/*.xml above this opens in G3 instead (browser-measured, C11) */
export const MAX_WORKSHEET_XML_BYTES = 40 * 1024 * 1024

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
  bytes: Uint8Array
  sheetNames: Map<string, string>
}

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
}

export function createWasmTransport(options: WasmTransportOptions): SheetsEngineTransport & {
  /** diagnostics: wasm memory and the engine's stderr tail */
  stats(): Promise<{ memoryBytes: number; stderr: string[] }>
} {
  const maxXml = options.maxWorksheetXmlBytes ?? MAX_WORKSHEET_XML_BYTES
  let channel: EngineChannel | null = null
  const sessions = new Map<string, Session>()
  const ch = () => (channel ??= options.connect())

  async function call(command: string, payload: Record<string, unknown>): Promise<unknown> {
    const requestId = `${command}-${uid()}`
    const line = JSON.stringify({ version: 1, requestId, command, ...payload })
    let response: EngineResponse
    try {
      response = await ch().request(line, requestId)
    } catch (err) {
      if ((err as { code?: string }).code === 'engine_crashed') {
        // a trapped engine lost every session: start over with a fresh one on the next call
        channel?.dispose()
        channel = null
        sessions.clear()
      }
      throw err
    }
    if (!response.ok) throw engineError(response, command)
    return response.result
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
      await call('close', { sessionId })
    } finally {
      await archive.remove(s.path).catch(() => {})
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
      const { data, plan } = await saveWorkbookBytes({
        engine: archive,
        sourcePath: s.path,
        sourceBytes: s.bytes,
        workDir: `${WORK_DIR}/save-${uid()}`,
        save: resolveSaveRequest(s.sheetNames, request),
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
