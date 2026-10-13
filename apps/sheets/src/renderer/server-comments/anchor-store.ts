/**
 * G8-13 (UNI-1408): where each server comment sits in the open workbook (spine S12, addendum §4.3).
 *
 * Server comments never enter the thread store or the note snapshot (lane decision D3): this store
 * keeps `comment id -> {live sheet id, range}` (or null = lost) beside it and follows the same edits
 * the thread store follows — row/column inserts and deletes, whole-row moves, cut/paste, sheet
 * removal — but for ranges, not only single cells: a range partly deleted shrinks, a range fully
 * deleted is lost. Renames need nothing here: entries hold the live sheet id and the anchor is
 * encoded from the live sheet at Save time.
 *
 * xlsx anchor `{format:'xlsx', v:1, sheet, range}` (contract-collab §4.1): `sheet` is the workbook's
 * stable sheet id (`sheet-<workbook.xml sheetId>`, what the reader gives every sheet of the file),
 * or the sheet name for a sheet added this session (it has no workbook id until it is saved and
 * reopened); `range` is A1 (`B7`, `B7:D9`).
 */
import { formatAddress, parseRange } from '@genoffice/xlsx-gateway/domain/cell-address'

import type { StructuralJournalOp } from '../edit-journal'
import type { CellRange } from '../threaded-comments'
import type { CollabAnchor } from './seam'

/** one sheet of the open workbook, in tab order */
export interface LiveSheet {
  /** the live (Univer) sheet id */
  readonly id: string
  readonly name: string
  /** the workbook's stable id when the sheet came from the file */
  readonly stableId?: string
}

export interface Located {
  readonly sheetId: string
  readonly range: CellRange
}

export interface XlsxAnchor extends CollabAnchor {
  format: 'xlsx'
  v: 1
  sheet: string
  range: string
}

/** the anchored root comments the store tracks (from the kit thread views) */
export interface TrackedRoot {
  readonly id: string
  readonly anchor?: CollabAnchor | null | undefined
  readonly anchor_state?: string | null | undefined
  readonly deleted?: boolean | undefined
}

const STABLE_SHEET_ID = /^sheet-\d+$/

/** the stable id a file sheet carries (the reader names every file sheet `sheet-<sheetId>`) */
export function stableSheetId(fileSheetId: string): string | undefined {
  return STABLE_SHEET_ID.test(fileSheetId) ? fileSheetId : undefined
}

export function asXlsxAnchor(anchor: CollabAnchor | null | undefined): XlsxAnchor | null {
  if (!anchor || anchor.format !== 'xlsx' || anchor.v !== 1) return null
  if (typeof anchor.sheet !== 'string' || anchor.sheet === '') return null
  if (typeof anchor.range !== 'string' || anchor.range === '') return null
  return anchor as XlsxAnchor
}

export function parseA1Range(range: string): CellRange | null {
  try {
    return parseRange(range.toUpperCase())
  } catch {
    return null
  }
}

export function formatA1Range(range: CellRange): string {
  const start = formatAddress(range.startRow, range.startColumn)
  if (range.startRow === range.endRow && range.startColumn === range.endColumn) return start
  return `${start}:${formatAddress(range.endRow, range.endColumn)}`
}

/** the live sheet an anchor names: its stable id first, then its name */
export function resolveSheet(sheets: readonly LiveSheet[], key: string): LiveSheet | undefined {
  return (
    sheets.find((sheet) => sheet.stableId === key) ?? sheets.find((sheet) => sheet.name === key)
  )
}

export function encodeXlsxAnchor(sheet: LiveSheet, range: CellRange): XlsxAnchor {
  return { format: 'xlsx', v: 1, sheet: sheet.stableId ?? sheet.name, range: formatA1Range(range) }
}

/** the location an anchor names in the open workbook, or null */
export function locateXlsxAnchor(
  sheets: readonly LiveSheet[],
  anchor: CollabAnchor | null | undefined,
): Located | null {
  const a = asXlsxAnchor(anchor)
  if (!a) return null
  const sheet = resolveSheet(sheets, a.sheet)
  const range = parseA1Range(a.range)
  return sheet && range ? { sheetId: sheet.id, range } : null
}

/** one axis span through an insert: an insert inside the span grows it */
function insertSpan(start: number, end: number, index: number, count: number): [number, number] {
  if (index <= start) return [start + count, end + count]
  if (index <= end) return [start, end + count]
  return [start, end]
}

/** one axis span through a delete: the kept part, or null when every line of it is gone */
function removeSpan(
  start: number,
  end: number,
  index: number,
  count: number,
): [number, number] | null {
  const last = index + count - 1
  const map = (line: number, edge: 'start' | 'end'): number => {
    if (line < index) return line
    if (line > last) return line - count
    return edge === 'start' ? index : index - 1
  }
  const nextStart = map(start, 'start')
  const nextEnd = map(end, 'end')
  return nextEnd < nextStart ? null : [nextStart, nextEnd]
}

/** a row through a whole-row move (the thread store's rule) */
function moveRow(row: number, index: number, count: number, before: number): number {
  if (row >= index && row < index + count) {
    return before > index ? row + (before - index - count) : row - (index - before)
  }
  if (before > index && row >= index + count && row < before) return row - count
  if (before < index && row >= before && row < index) return row + count
  return row
}

/** a range through one structural edit of its sheet; null = every cell of it was deleted */
export function shiftRange(range: CellRange, op: StructuralJournalOp): CellRange | null {
  switch (op.kind) {
    case 'insert-rows': {
      const [startRow, endRow] = insertSpan(range.startRow, range.endRow, op.index, op.count)
      return startRow === range.startRow && endRow === range.endRow
        ? range
        : { ...range, startRow, endRow }
    }
    case 'insert-cols': {
      const [startColumn, endColumn] = insertSpan(
        range.startColumn,
        range.endColumn,
        op.index,
        op.count,
      )
      return startColumn === range.startColumn && endColumn === range.endColumn
        ? range
        : { ...range, startColumn, endColumn }
    }
    case 'remove-rows': {
      const span = removeSpan(range.startRow, range.endRow, op.index, op.count)
      if (!span) return null
      return span[0] === range.startRow && span[1] === range.endRow
        ? range
        : { ...range, startRow: span[0], endRow: span[1] }
    }
    case 'remove-cols': {
      const span = removeSpan(range.startColumn, range.endColumn, op.index, op.count)
      if (!span) return null
      return span[0] === range.startColumn && span[1] === range.endColumn
        ? range
        : { ...range, startColumn: span[0], endColumn: span[1] }
    }
    case 'move-rows': {
      const a = moveRow(range.startRow, op.index, op.count, op.before)
      const b = moveRow(range.endRow, op.index, op.count, op.before)
      const startRow = Math.min(a, b)
      const endRow = Math.max(a, b)
      return startRow === range.startRow && endRow === range.endRow
        ? range
        : { ...range, startRow, endRow }
    }
    default:
      return range
  }
}

function inside(range: CellRange, outer: CellRange): boolean {
  return (
    range.startRow >= outer.startRow &&
    range.endRow <= outer.endRow &&
    range.startColumn >= outer.startColumn &&
    range.endColumn <= outer.endColumn
  )
}

type Listener = () => void

export class ServerAnchorStore {
  /** comment id -> live location; null = lost */
  private entries = new Map<string, Located | null>()
  /** the list's anchor objects -> comment id: the kit adapter sees anchors, not ids */
  private byAnchor = new WeakMap<CollabAnchor, string>()
  /** stable sheet id -> the last name this workbook showed for it (labels of sheets gone since) */
  private knownNames = new Map<string, string>()
  private listeners = new Set<Listener>()
  private version = 0
  private epoch = 0

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  /** bumps on every reset: the panel re-tracks its listed roots against the reopened workbook */
  getEpoch = (): number => this.epoch

  /** another workbook opened (or the same one reopened without a Save): nothing carries over */
  reset(): void {
    this.byAnchor = new WeakMap()
    this.entries = new Map()
    this.knownNames = new Map()
    this.epoch += 1
    this.bump()
  }

  /** a sheet was renamed (or its name changed otherwise): labels must be recomputed */
  sheetRenamed(_sheetId: string): void {
    this.bump()
  }

  /** the last name a stable sheet id had in this workbook, when it had one */
  knownName(stableId: string): string | undefined {
    return this.knownNames.get(stableId)
  }

  /**
   * The workbook was reopened over the same document (every Save does this): the live sheet ids
   * changed, the names did not. `previous` = old live id -> name, `next` = the reopened sheets.
   */
  rebase(
    previous: ReadonlyMap<string, string>,
    next: readonly { id: string; name: string }[],
  ): void {
    let changed = false
    for (const [id, at] of this.entries) {
      if (!at) continue
      const name = previous.get(at.sheetId)
      const sheet = name === undefined ? undefined : next.find((s) => s.name === name)
      if (sheet?.id === at.sheetId) continue
      this.entries.set(id, sheet ? { ...at, sheetId: sheet.id } : null)
      changed = true
    }
    if (changed) this.bump()
  }

  /**
   * The latest server roots: a new id is located once from its server anchor (a server-lost one
   * stays lost); a known id keeps its live location. True when anything changed. Also remembers
   * the names of the workbook's stable sheet ids for labels.
   */
  track(roots: readonly TrackedRoot[], sheets: readonly LiveSheet[]): boolean {
    let changed = false
    for (const sheet of sheets) {
      if (sheet.stableId) this.knownNames.set(sheet.stableId, sheet.name)
    }
    for (const root of roots) {
      const anchor = asXlsxAnchor(root.anchor)
      if (!anchor || root.deleted) continue
      // a reloaded list brings new anchor objects: the adapter must be rebuilt to see them
      if (this.byAnchor.get(anchor) !== root.id) {
        this.byAnchor.set(anchor, root.id)
        changed = true
      }
      if (this.entries.has(root.id)) continue
      // no sheets yet (a list that lands before the workbook is in Univer): not located yet, which
      // is not lost; the id stays untracked and the next track locates it
      if (sheets.length === 0 && root.anchor_state !== 'lost') continue
      this.entries.set(
        root.id,
        root.anchor_state === 'lost' ? null : locateXlsxAnchor(sheets, anchor),
      )
      changed = true
    }
    if (changed) this.bump()
    return changed
  }

  /** undefined = not tracked; null = lost */
  locationOf(id: string): Located | null | undefined {
    return this.entries.get(id)
  }

  /** the comment whose listed anchor object this is */
  idOf(anchor: CollabAnchor): string | undefined {
    return this.byAnchor.get(anchor)
  }

  /** a row/column insert, delete or whole-row move on `sheetId` */
  applyStructuralOp(sheetId: string, op: StructuralJournalOp): void {
    let changed = false
    for (const [id, at] of this.entries) {
      if (!at || at.sheetId !== sheetId) continue
      const range = shiftRange(at.range, op)
      if (range === at.range) continue
      this.entries.set(id, range ? { sheetId, range } : null)
      changed = true
    }
    if (changed) this.bump()
  }

  /** cut/paste or drag-move: anchors wholly inside the source travel with their cells */
  moveRange(fromSheetId: string, from: CellRange, toSheetId: string, to: CellRange): void {
    let changed = false
    for (const [id, at] of this.entries) {
      if (!at || at.sheetId !== fromSheetId || !inside(at.range, from)) continue
      const dr = to.startRow - from.startRow
      const dc = to.startColumn - from.startColumn
      this.entries.set(id, {
        sheetId: toSheetId,
        range: {
          startRow: at.range.startRow + dr,
          endRow: at.range.endRow + dr,
          startColumn: at.range.startColumn + dc,
          endColumn: at.range.endColumn + dc,
        },
      })
      changed = true
    }
    if (changed) this.bump()
  }

  /** a deleted sheet: its anchors are lost */
  removeSheet(sheetId: string): void {
    let changed = false
    for (const [id, at] of this.entries) {
      if (!at || at.sheetId !== sheetId) continue
      this.entries.set(id, null)
      changed = true
    }
    if (changed) this.bump()
  }

  /** a located comment starts at this cell (the display-only marker; never a note) */
  hasMarker(sheetId: string, row: number, column: number): boolean {
    for (const at of this.entries.values()) {
      if (at && at.sheetId === sheetId && at.range.startRow === row) {
        if (at.range.startColumn === column) return true
      }
    }
    return false
  }

  private bump(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}

export const serverAnchorStore = new ServerAnchorStore()
