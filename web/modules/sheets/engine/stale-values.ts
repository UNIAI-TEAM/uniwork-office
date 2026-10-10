/**
 * No stale cached values on save (UNI-1232, A2).
 *
 * A save patches only the cells the user edited; every other formula keeps the `<v>` it had in
 * the file. A formula that depends (directly or through other formulas, on any sheet) on an
 * edited cell would therefore be written back with the OLD result, and a reader that trusts
 * cached values (the streamed web grid, a preview, a CSV export, openpyxl data_only) shows a
 * number the sheet no longer computes. The gateway already sets `fullCalcOnLoad` and drops
 * `calcChain` on every save, so Excel and the desktop recalculate on open; this module covers
 * everything else.
 *
 * The rule, the SAFE one: a save that can change a value never leaves a cached `<v>` that was not
 * recomputed in that same save.
 *   1. refresh: when the engine can replay the save (no structural / sheet / pivot / name change,
 *      file <= 64 MB, <= 10 000 edits, IronCalc imports the workbook), every formula cell of the
 *      file is recalculated by `recalc_cells` and written with its new result (cached-values.ts).
 *      An error the engine cannot be trusted with on a formula the user did not touch (IronCalc
 *      lacks a function Excel has) is written as no value instead of as a wrong error.
 *   2. sweep: in every other case (structural change pending, a sheet added or removed this
 *      session, bulk fills, pivot output, defined-name change, > 64 MB, > 10 000 edits,
 *      > 200 000 formulas, strict importer failure, engine crash) the cached `<v>` of every
 *      formula cell is dropped from the saved file (`rewriteFormulaCachedValues`). The formulas stay
 *      verbatim, so the next open (Excel, the desktop, Univer where the closure fits) recomputes.
 * A save that cannot change a value (formatting, widths, tab colours, notes...) touches nothing.
 * Known limits: values spilled by a dynamic array are plain `<v>` cells (no `<f>`), they are not
 * recognised; SUBTOTAL over rows hidden by a filter is not treated as a value change.
 */
import type { WorkbookSaveRequest } from '../../../../apps/sheets/src/shared/desktop-api'

/** structural ops that change what a formula computes (sizes, styles and outline levels do not) */
const VALUE_STRUCTURAL_KINDS: ReadonlySet<string> = new Set([
  'insert-rows',
  'remove-rows',
  'insert-cols',
  'remove-cols',
  'move-rows',
  'merge-cells',
  // SUBTOTAL(1xx) and AGGREGATE skip hidden rows
  'set-rows-hidden',
  'set-cols-hidden',
])

/** can this save change the result of any formula? (false: leave every cached value alone) */
export function savedValuesMayChange(request: WorkbookSaveRequest): boolean {
  return (
    request.edits.some((edit) => edit.writeValue || edit.formula !== undefined) ||
    (request.bulkConstantFills?.length ?? 0) > 0 ||
    request.structuralOps.some((op) => VALUE_STRUCTURAL_KINDS.has(op.kind)) ||
    request.sheetOps.some((op) => op.kind === 'remove-sheet') ||
    request.pivotAdditions.length > 0 ||
    request.pivotRefreshUpdates.length > 0 ||
    request.definedNamesState !== null
  )
}

/**
 * Can the engine replay this save's edits? The recalc model is the file as opened plus the cell
 * edits, so anything that moves cells, adds or removes sheets, fills ranges, writes pivot output
 * or changes names makes its answers wrong for the saved file.
 */
export function engineCanReplaySave(request: WorkbookSaveRequest): boolean {
  return (
    request.structuralOps.every((op) => !VALUE_STRUCTURAL_KINDS.has(op.kind)) &&
    request.sheetOps.every((op) => op.kind === 'set-sheet-tab-color') &&
    (request.bulkConstantFills?.length ?? 0) === 0 &&
    request.pivotAdditions.length === 0 &&
    request.pivotRefreshUpdates.length === 0 &&
    request.pivotCacheRefreshPaths.length === 0 &&
    request.definedNamesState === null
  )
}

const entityText: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, entity: string) => {
    if (entity[0] !== '#') return entityText[entity.toLowerCase()] ?? _m
    const code =
      entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : _m
  })
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
}

/** workbook sheet name -> its worksheet part (the gateway's resolveWorksheetPath for every sheet) */
export function worksheetPartsByName(workbookXml: string, relsXml: string): Map<string, string> {
  const targets = new Map<string, string>()
  for (const rel of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(rel[0], 'Id')
    const target = attr(rel[0], 'Target')
    if (id !== undefined && target !== undefined) targets.set(id, decodeXml(target))
  }
  const parts = new Map<string, string>()
  for (const sheet of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(sheet[0], 'name')
    const rid = /\br:id="([^"]*)"/.exec(sheet[0])?.[1]
    const target = rid === undefined ? undefined : targets.get(rid)
    if (name === undefined || target === undefined) continue
    parts.set(decodeXml(name), target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  return parts
}

/** `<c ...>` elements: group 1 = attributes, group 2 = body (undefined for `<c .../>`) */
const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
const HAS_FORMULA = /<f[\s/>]/
const HAS_VALUE = /<v[\s/>]/
const VALUE_ELEMENT = /<v\b[^>]*\/>|<v\b[^>]*>[\s\S]*?<\/v>/g

function columnIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** 0-based row and column of every formula cell of a worksheet part (shared followers included) */
export function formulaCells(worksheetXml: string): { row: number; column: number }[] {
  const cells: { row: number; column: number }[] = []
  for (const match of worksheetXml.matchAll(CELL)) {
    const body = match[2]
    if (body === undefined || !HAS_FORMULA.test(body)) continue
    const ref = /\br="([A-Z]{1,3})(\d+)"/.exec(match[1] ?? '')
    if (!ref) continue
    cells.push({ row: Number(ref[2]) - 1, column: columnIndex(ref[1] ?? 'A') })
  }
  return cells
}

/** a formula's result as the gateway types it: number, text, boolean, `{ error }`, or null = none */
export type CachedValue = string | number | boolean | null | { readonly error: string }

const escapeText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** `t` attribute and `<v>` for a cached result, as the gateway's patchFormulaCachedValue writes them */
function serializeCached(value: CachedValue | undefined): { type: string; valueXml: string } {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { type: '', valueXml: `<v>${value}</v>` }
  }
  if (typeof value === 'boolean') return { type: ' t="b"', valueXml: `<v>${value ? 1 : 0}</v>` }
  if (typeof value === 'object' && value !== null) {
    return { type: ' t="e"', valueXml: `<v>${escapeText(value.error)}</v>` }
  }
  if (typeof value === 'string' && value !== '') {
    return { type: ' t="str"', valueXml: `<v>${escapeText(value)}</v>` }
  }
  return { type: '', valueXml: '' }
}

const FORMULA_ELEMENT = /<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/

/**
 * The worksheet with the cached value of every formula cell rewritten: `valueAt(row, column)`
 * (0-based) gives the result to write, anything else (undefined, null, empty text) removes the
 * `<v>` and the `t` attribute that typed it. The `<f>` stays verbatim. Returns the input string
 * itself when nothing changed.
 */
export function rewriteFormulaCachedValues(
  worksheetXml: string,
  valueAt?: (row: number, column: number) => CachedValue | undefined,
): string {
  return worksheetXml.replace(CELL, (whole, attrs: string, body: string | undefined) => {
    if (body === undefined || !HAS_FORMULA.test(body)) return whole
    let value: CachedValue | undefined
    if (valueAt) {
      const ref = /\br="([A-Z]{1,3})(\d+)"/.exec(attrs)
      if (ref) value = valueAt(Number(ref[2]) - 1, columnIndex(ref[1] ?? 'A'))
    }
    const { type, valueXml } = serializeCached(value)
    if (valueXml === '' && !HAS_VALUE.test(body)) return whole
    const kept = body.replace(VALUE_ELEMENT, '')
    const withValue =
      valueXml === '' ? kept : kept.replace(FORMULA_ELEMENT, (f) => `${f}${valueXml}`)
    return `<c${attrs.replace(/\st="[^"]*"/g, '')}${type}>${withValue}</c>`
  })
}
