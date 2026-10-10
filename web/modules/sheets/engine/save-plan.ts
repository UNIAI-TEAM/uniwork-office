/**
 * Save in the Sheets frame (UNI-1016): the renderer's WorkbookSaveRequest -> new xlsx bytes.
 *
 * Mirrors the desktop pipeline with the same gateway code:
 *   - `resolveSaveRequest` is apps/sheets/src/main/sheets-main.ts `writeWorkbookTo` (sheet-op
 *     resolution, sheetId -> file sheet name for every edit family). Keep the two in step.
 *   - `saveWorkbookBytes` is packages/xlsx-gateway/src/gateway/xlsx-package-io.ts
 *     `saveWorkbookViaSidecar` with the session's bytes in memory instead of a snapshot file: the
 *     gateway planner (planCellEditsToXlsx) reads parts through a lazy JSZip entry source, the
 *     engine's `archive_manifest` / `save_archive` stream-copy every untouched part, and the same
 *     manifest checks (unchanged base, only declared parts changed) guard the result.
 */
import JSZip from 'jszip'
import type {
  CellEdit,
  EntrySource,
  MutationPlan,
  SheetStructuralOps,
} from '../../../../packages/xlsx-gateway/src/gateway/xlsx-gateway'
import { planCellEditsToXlsx } from '../../../../packages/xlsx-gateway/src/gateway/xlsx-gateway'
import { assertManifestPreserved } from '../../../../packages/xlsx-gateway/src/gateway/xlsx-package-io'
import type { ArchiveEntry } from '../../../../packages/xlsx-gateway/src/gateway/xlsx-package-io'
import { normalizeOoxmlPartPrefix } from '../../../../packages/xlsx-gateway/src/gateway/xlsx-namespace'
import type { SheetEditPlan } from '../../../../packages/xlsx-gateway/src/gateway/xlsx-sheets'
import { MAX_PATCH_ENTRY_BYTES } from '../../../../packages/xlsx-gateway/src/shared/edit-schemas'
import type { WorkbookSaveRequest } from '../../../../apps/sheets/src/shared/desktop-api'
import { rewriteFormulaCachedValues, type CachedValue } from './stale-values'

type PlanArgs = Parameters<typeof planCellEditsToXlsx>

/** the gateway arguments of one save, sheet ids resolved to the file's sheet names */
export interface ResolvedSave {
  edits: CellEdit[]
  args: Omit<
    {
      structuralOps: PlanArgs[2]
      chartEdits: PlanArgs[3]
      sheetPlan: PlanArgs[4]
      filterStates: PlanArgs[5]
      hyperlinkEdits: PlanArgs[6]
      cfStates: PlanArgs[7]
      dvStates: PlanArgs[8]
      sheetProtections: PlanArgs[9]
      definedNamesState: PlanArgs[10]
      visualAdditions: PlanArgs[11]
      pageSetupStates: PlanArgs[12]
      noteStates: PlanArgs[13]
      tableAdditions: PlanArgs[14]
      pivotAdditions: PlanArgs[15]
      pivotCacheRefreshPaths: PlanArgs[16]
      pivotRefreshUpdates: PlanArgs[17]
      visualEdits: PlanArgs[18]
      sparklineAdditions: PlanArgs[19]
      formulaValues: PlanArgs[20]
      themeState: PlanArgs[21]
      workbookProtectionState: PlanArgs[22]
      protectedRangeStates: PlanArgs[23]
      bulkConstantFills: PlanArgs[24]
      tabColorStates: PlanArgs[25]
      tableEdits: PlanArgs[26]
    },
    never
  >
}

/** sheets-main.ts writeWorkbookTo, minus the I/O */
export function resolveSaveRequest(
  sheetNames: ReadonlyMap<string, string>,
  request: WorkbookSaveRequest,
): ResolvedSave {
  // Sheet ops resolve first: added sheets have Univer ids the session map
  // doesn't know, so cell edits into them resolve through the op's name.
  const addedSheetNames = new Map<string, string>()
  const duplicateSources = new Map<string, string>()
  const renames: { sheetName: string; newName: string }[] = []
  const removals: string[] = []
  const hiddenChanges: { sheetName: string; hidden: boolean }[] = []
  const tabColorStates: { sheetName: string; color: string | null }[] = []
  let orderChanged = false
  for (const op of request.sheetOps) {
    if (op.kind === 'add-sheet') {
      addedSheetNames.set(op.sheetId, op.name)
      continue
    }
    if (op.kind === 'duplicate-sheet') {
      const sourceName = sheetNames.get(op.sourceSheetId)
      if (!sourceName) throw new Error(`Unknown duplicate source ${op.sourceSheetId}.`)
      addedSheetNames.set(op.sheetId, op.name)
      duplicateSources.set(op.sheetId, sourceName)
      continue
    }
    if (op.kind === 'reorder-sheets') {
      orderChanged = true
      continue
    }
    const sheetName = addedSheetNames.get(op.sheetId) ?? sheetNames.get(op.sheetId)
    if (!sheetName) throw new Error(`Unknown worksheet ${op.sheetId}.`)
    if (op.kind === 'rename-sheet') renames.push({ sheetName, newName: op.newName })
    else if (op.kind === 'set-sheet-hidden') hiddenChanges.push({ sheetName, hidden: op.hidden })
    else if (op.kind === 'set-sheet-tab-color') tabColorStates.push({ sheetName, color: op.color })
    else removals.push(sheetName)
  }
  const renameByOriginal = new Map(renames.map((rename) => [rename.sheetName, rename.newName]))
  const resolveSheetName = (sheetId: string): string => {
    const sheetName = addedSheetNames.get(sheetId) ?? sheetNames.get(sheetId)
    if (!sheetName) throw new Error(`Unknown worksheet ${sheetId}.`)
    return sheetName
  }
  let sheetPlan: SheetEditPlan | undefined
  if (request.sheetOps.some((op) => op.kind !== 'set-sheet-tab-color')) {
    sheetPlan = {
      renames,
      additions: [...addedSheetNames].map(([sheetId, name]) => ({
        name,
        sourceSheetName: duplicateSources.get(sheetId),
      })),
      removals,
      hiddenChanges,
      orderChanged,
      order: request.sheetOrder.map((sheetId) => {
        const original = resolveSheetName(sheetId)
        return addedSheetNames.has(sheetId)
          ? original
          : (renameByOriginal.get(original) ?? original)
      }),
    }
  }

  const edits: CellEdit[] = request.edits.map((edit) => ({
    sheetName: resolveSheetName(edit.sheetId),
    row: edit.row,
    column: edit.column,
    writeValue: edit.writeValue,
    cell: { value: edit.value, formula: edit.formula },
    style: edit.style,
    rich: edit.rich,
    styleReset: edit.styleReset,
  }))
  const bulkConstantFills = (request.bulkConstantFills ?? []).map(({ sheetId, ...fill }) => ({
    sheetName: resolveSheetName(sheetId),
    ...fill,
  }))
  const opsBySheet = new Map<string, SheetStructuralOps['ops'][number][]>()
  for (const op of request.structuralOps) {
    const sheetName = resolveSheetName(op.sheetId)
    const sheetOps = opsBySheet.get(sheetName) ?? []
    if ('range' in op) {
      sheetOps.push({ kind: op.kind, range: op.range })
    } else if ('size' in op) {
      sheetOps.push({ kind: op.kind, start: op.start, end: op.end, size: op.size })
    } else if ('level' in op) {
      sheetOps.push({
        kind: op.kind,
        start: op.start,
        end: op.end,
        level: op.level,
        ...(op.collapsed === undefined ? {} : { collapsed: op.collapsed }),
      })
    } else if ('summaryBelow' in op) {
      sheetOps.push({
        kind: op.kind,
        summaryBelow: op.summaryBelow,
        summaryRight: op.summaryRight,
      })
    } else if ('hidden' in op) {
      sheetOps.push({ kind: op.kind, start: op.start, end: op.end, hidden: op.hidden })
    } else if ('style' in op) {
      sheetOps.push({ kind: op.kind, start: op.start, end: op.end, style: op.style })
    } else if ('before' in op) {
      sheetOps.push({ kind: op.kind, index: op.index, count: op.count, before: op.before })
    } else {
      sheetOps.push({ kind: op.kind, index: op.index, count: op.count })
    }
    opsBySheet.set(sheetName, sheetOps)
  }
  const structuralOps: SheetStructuralOps[] = [...opsBySheet].map(([sheetName, ops]) => ({
    sheetName,
    ops,
  }))
  const linksBySheet = new Map<string, { row: number; column: number; target: string | null }[]>()
  for (const link of request.hyperlinkEdits) {
    const sheetName = resolveSheetName(link.sheetId)
    const sheetLinks = linksBySheet.get(sheetName) ?? []
    sheetLinks.push({ row: link.row, column: link.column, target: link.target })
    linksBySheet.set(sheetName, sheetLinks)
  }
  const formulaValuesBySheet = new Map<
    string,
    { row: number; column: number; value: string | number | boolean | null | { error: string } }[]
  >()
  for (const cell of request.formulaValues) {
    const sheetName = resolveSheetName(cell.sheetId)
    const list = formulaValuesBySheet.get(sheetName) ?? []
    list.push({ row: cell.row, column: cell.column, value: cell.value })
    formulaValuesBySheet.set(sheetName, list)
  }
  return {
    edits,
    args: {
      structuralOps,
      chartEdits: request.chartEdits,
      sheetPlan,
      filterStates: request.filterStates.map((state) => ({
        sheetName: resolveSheetName(state.sheetId),
        filter: state.filter,
        hiddenRows: state.hiddenRows,
        visibilityRange: state.visibilityRange,
      })),
      hyperlinkEdits: [...linksBySheet].map(([sheetName, links]) => ({ sheetName, edits: links })),
      cfStates: request.cfStates.map((state) => ({
        sheetName: resolveSheetName(state.sheetId),
        rules: state.rules,
      })),
      dvStates: request.dvStates.map((state) => ({
        sheetName: resolveSheetName(state.sheetId),
        rules: state.rules,
      })),
      sheetProtections: request.sheetProtections.map(({ sheetId, ...state }) => ({
        sheetName: resolveSheetName(sheetId),
        ...state,
      })),
      definedNamesState: request.definedNamesState,
      visualAdditions: request.visualAdditions.map((addition) => ({
        sheetName: resolveSheetName(addition.sheetId),
        anchor: addition.anchor,
        chart: addition.chart,
        shape: addition.shape,
        image: addition.image,
      })),
      pageSetupStates: request.pageSetupStates.map(({ sheetId, ...state }) => ({
        sheetName: resolveSheetName(sheetId),
        ...state,
      })),
      noteStates: request.noteStates.map(({ sheetId, notes }) => ({
        sheetName: resolveSheetName(sheetId),
        notes,
      })),
      tableAdditions: request.tableAdditions.map((table) => ({
        sheetName: resolveSheetName(table.sheetId),
        area: table.area,
        name: table.name,
        columnNames: table.columnNames,
        style: table.style,
        bandedRows: table.bandedRows,
        options: {
          headerRow: table.headerRow,
          totalsRow: table.totalsRow,
          firstColumn: table.firstColumn,
          lastColumn: table.lastColumn,
          bandedColumns: table.bandedColumns,
          filterButton: table.filterButton,
        },
      })),
      tableEdits: (request.tableEdits ?? []).map(({ sheetId, ...edit }) => ({
        ...edit,
        sheetName: resolveSheetName(sheetId),
      })),
      pivotAdditions: request.pivotAdditions.map((pivot) => ({
        sheetName: resolveSheetName(pivot.sheetId),
        sourceSheetName: resolveSheetName(pivot.sourceSheetId),
        sourceArea: pivot.sourceArea,
        location: pivot.location,
        name: pivot.name,
        fieldNames: pivot.fieldNames,
        rowFieldIndices: pivot.rowFieldIndices,
        columnFieldIndex: pivot.columnFieldIndex,
        pageFieldIndices: pivot.pageFieldIndices,
        pageLevelItems: pivot.pageLevelItems,
        pageItems: pivot.pageItems,
        rowItems: pivot.rowItems,
        rowLevelItems: pivot.rowLevelItems,
        rowLines: pivot.rowLines,
        columnItems: pivot.columnItems,
        columnFieldIndices: pivot.columnFieldIndices,
        colLevelItems: pivot.colLevelItems,
        colLines: pivot.colLines,
        groupings: pivot.groupings,
        filters: pivot.filters,
        rowHiddenItems: pivot.rowHiddenItems,
        colHiddenItems: pivot.colHiddenItems,
        values: pivot.values,
      })),
      pivotCacheRefreshPaths: request.pivotCacheRefreshPaths,
      pivotRefreshUpdates: request.pivotRefreshUpdates.map((update) => ({
        cachePath: update.cachePath,
        sheetName: resolveSheetName(update.sheetId),
        newOutputRef: update.newOutputRef,
        ...(update.relayout === undefined
          ? {}
          : {
              relayout: (({ sheetId: _sheetId, sourceSheetId, ...rest }) => ({
                ...rest,
                sourceSheetName: resolveSheetName(sourceSheetId),
              }))(update.relayout),
            }),
      })),
      visualEdits: request.visualEdits,
      sparklineAdditions: request.sparklineAdditions.map(({ sheetId, ...group }) => ({
        sheetName: resolveSheetName(sheetId),
        ...group,
      })),
      formulaValues: [...formulaValuesBySheet].map(([sheetName, cells]) => ({ sheetName, cells })),
      themeState: request.themeState,
      workbookProtectionState: request.workbookProtectionState,
      protectedRangeStates: request.protectedRangeStates.map((state) => ({
        sheetName: resolveSheetName(state.sheetId),
        ranges: state.ranges,
      })),
      bulkConstantFills,
      tabColorStates,
    },
  }
}

/** the engine operations a save needs (implemented by ./wasm-transport.ts over its channel) */
export interface ArchiveEngine {
  manifest(path: string): Promise<ArchiveEntry[]>
  writeFile(path: string, data: Uint8Array): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  remove(path: string): Promise<void>
  saveArchive(input: {
    sourcePath: string
    targetPath: string
    replacements: { name: string; contentPath: string }[]
    removals: string[]
    additions: { name: string; contentPath: string }[]
  }): Promise<{ beforeEntries: ArchiveEntry[]; afterEntries: ArchiveEntry[] }>
}

/** parts read straight from the session's bytes (lazy: only what the planner asks for) */
export function bytesEntrySource(
  bytes: Uint8Array,
  manifest: readonly ArchiveEntry[],
): EntrySource {
  const byName = new Map(manifest.map((entry) => [entry.name, entry]))
  let zip: Promise<JSZip> | null = null
  const cache = new Map<string, string>()
  const load = () => (zip ??= JSZip.loadAsync(bytes, { checkCRC32: false }))
  return {
    paths: async () => manifest.map((entry) => entry.name),
    has: async (path) => byName.has(path),
    canPatch: async (path) => (byName.get(path)?.uncompressedSize ?? 0) <= MAX_PATCH_ENTRY_BYTES,
    containsText: async (path, needle) => {
      const file = (await load()).file(path)
      return file ? (await file.async('text')).includes(needle) : false
    },
    releaseText: (path) => {
      cache.delete(path)
    },
    readText: async (path) => {
      const cached = cache.get(path)
      if (cached !== undefined) return cached
      if (!byName.has(path)) throw new Error(`Workbook is missing ${path}.`)
      const file = (await load()).file(path)
      if (!file) throw new Error(`Workbook is missing ${path}.`)
      const text = normalizeOoxmlPartPrefix(await file.async('text'))
      cache.set(path, text)
      return text
    },
  }
}

function manifestsEqual(left: readonly ArchiveEntry[], right: readonly ArchiveEntry[]): boolean {
  if (left.length !== right.length) return false
  const key = (e: ArchiveEntry) =>
    `${e.name}\u0000${e.crc32}\u0000${e.compressedSize}\u0000${e.uncompressedSize}`
  const keys = new Set(left.map(key))
  return right.every((entry) => keys.has(key(entry)))
}

const textEncoder = new TextEncoder()

/**
 * The plan with every worksheet part's formula cells holding exactly `keep` (the part as the plan
 * wrote it, else as in the source). Only parts that change are added to the plan, so the engine
 * stream-copies the rest. The gateway writes cached values only into worksheets it already edits;
 * a dependent on another sheet is reached here.
 */
async function rewriteCachedValues(
  plan: MutationPlan,
  source: EntrySource,
  keep: ReadonlyMap<string, ReadonlyMap<string, CachedValue>>,
): Promise<MutationPlan> {
  const isSheet = (path: string) => /^xl\/worksheets\/[^/]+\.xml$/i.test(path)
  const rewrite = (path: string, xml: string) => {
    const values = keep.get(path)
    return rewriteFormulaCachedValues(
      xml,
      values && ((row, column) => values.get(`${row}:${column}`)),
    )
  }
  const replaced = new Map(plan.replaced)
  const added = new Map(plan.added)
  const touched = new Set(plan.touchedEntries)
  const removed = new Set(plan.removedEntries)
  // a sheet added this session (a duplicate copies the source part, cached values included)
  for (const [path, xml] of plan.added) if (isSheet(path)) added.set(path, rewrite(path, xml))
  for (const path of await source.paths()) {
    if (!isSheet(path) || removed.has(path)) continue
    const before = replaced.get(path) ?? (await source.readText(path))
    const after = rewrite(path, before)
    if (after === before) continue
    replaced.set(path, after)
    touched.add(path)
  }
  return { ...plan, replaced, added, touchedEntries: [...touched] }
}

/** xlsx-package-io.ts saveWorkbookViaSidecar over the in-memory engine */
export async function saveWorkbookBytes(input: {
  engine: ArchiveEngine
  /** engine path of the session's workbook (the save base) */
  sourcePath: string
  /** the same bytes, for the planner's reads */
  sourceBytes: Uint8Array
  /** a scratch directory under /tmp for this save */
  workDir: string
  save: ResolvedSave
  /**
   * stale-values.ts: the ONLY cached values the saved file may carry. Every formula cell of every
   * worksheet part gets its entry (worksheet part path -> "row:column", 0-based) or loses its `<v>`;
   * an empty map is the sweep. Absent: cached values stay as they are.
   */
  cachedValues?: ReadonlyMap<string, ReadonlyMap<string, CachedValue>>
}): Promise<{ data: Uint8Array; plan: MutationPlan }> {
  const { engine, sourcePath, workDir, save } = input
  const manifest = await engine.manifest(sourcePath)
  const a = save.args
  const source = bytesEntrySource(input.sourceBytes, manifest)
  const planned = await planCellEditsToXlsx(
    source,
    save.edits,
    a.structuralOps,
    a.chartEdits,
    a.sheetPlan,
    a.filterStates,
    a.hyperlinkEdits,
    a.cfStates,
    a.dvStates,
    a.sheetProtections,
    a.definedNamesState,
    a.visualAdditions,
    a.pageSetupStates,
    a.noteStates,
    a.tableAdditions,
    a.pivotAdditions,
    a.pivotCacheRefreshPaths,
    a.pivotRefreshUpdates,
    a.visualEdits,
    a.sparklineAdditions,
    a.formulaValues,
    a.themeState,
    a.workbookProtectionState,
    a.protectedRangeStates,
    a.bulkConstantFills,
    a.tabColorStates,
    a.tableEdits,
  )
  const plan = input.cachedValues
    ? await rewriteCachedValues(planned, source, input.cachedValues)
    : planned
  const written: string[] = []
  const write = async (prefix: string, contents: ReadonlyMap<string, string | Uint8Array>) => {
    const out: { name: string; contentPath: string }[] = []
    let index = 0
    for (const [name, content] of contents) {
      const contentPath = `${workDir}/${prefix}-${index++}.bin`
      await engine.writeFile(
        contentPath,
        typeof content === 'string' ? textEncoder.encode(content) : content,
      )
      written.push(contentPath)
      out.push({ name, contentPath })
    }
    return out
  }
  const targetPath = `${workDir}/saved.xlsx`
  try {
    // the engine creates parent directories only on writeFile: a save with nothing to write
    // (Save As or a restored draft's write-back without edits) still needs workDir to exist
    const marker = `${workDir}/.dir`
    await engine.writeFile(marker, new Uint8Array())
    written.push(marker)
    const replacements = await write('replace', plan.replaced)
    const additions = [
      ...(await write('add', plan.added)),
      ...(await write('add-bin', plan.addedBinary)),
    ]
    const result = await engine.saveArchive({
      sourcePath,
      targetPath,
      replacements,
      removals: [...plan.removedEntries],
      additions,
    })
    if (!manifestsEqual(manifest, result.beforeEntries)) {
      throw new Error('The workbook changed while saving — aborted.')
    }
    assertManifestPreserved(plan, result.beforeEntries, result.afterEntries)
    return { data: await engine.readFile(targetPath), plan }
  } finally {
    for (const path of [...written, targetPath]) await engine.remove(path).catch(() => {})
  }
}
