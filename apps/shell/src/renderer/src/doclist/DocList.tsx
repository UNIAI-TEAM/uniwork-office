import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { UniworkSourceFile } from '../../../shared/home-api'
import { useI18n } from '../locale'
import type { FolderMenuItem } from '../uniwork-folders/FolderMenu'
import type { DocumentsHomeDoc, DocumentsHomeTableRow } from '../uniwork-home/documents-home-model'
import { trackOf } from './cells'
import {
  COLUMN_LABEL_KEY,
  isSortable,
  nextSort,
  specialColumn,
  type ColumnId,
  type DocListScreen,
  type SortSpec,
} from './columns'
import { DocRow, type DocRowRename, type DocSubline } from './DocRow'
import { GroupHeader } from './GroupHeader'
import { groupRows, groupsActive, type GroupInput } from './groups'
import { useCollapsedGroups } from './use-collapsed-groups'
import { effectiveSort, sortTableRows, specialPresent, visibleColumns } from './table-model'

export interface DocListProps {
  screen: DocListScreen
  /** the loaded rows, in any order: the table sorts them */
  rows: readonly DocumentsHomeTableRow[]
  /** the sort the person chose on this screen; null = the screen default */
  sort: SortSpec | null
  onSortChange: (next: SortSpec) => void
  selected: ReadonlySet<string>
  onSelectedChange: (next: Set<string>) => void
  /** accessible name of the table */
  label: string
  openingId?: string | null
  openMenuId: string | null
  onOpenMenuChange: (id: string | null) => void
  menuFor: (doc: DocumentsHomeDoc) => FolderMenuItem[]
  /** a row's own buttons before its "…" menu */
  actionsFor?: (doc: DocumentsHomeDoc) => ReactNode
  onOpen: (doc: DocumentsHomeDoc) => void
  sublineFor?: (doc: DocumentsHomeDoc) => DocSubline | null
  /** the document being renamed in place, with its field's handlers */
  rename?: { docId: string } & DocRowRename
  /** a row of another module's file (the workspace root lists them with the documents) */
  renderSource?: (source: UniworkSourceFile, columns: readonly ColumnId[]) => ReactNode
}

/** the screens whose rows fall in day / week groups under their own column (Trash's groups are its own slice) */
const GROUPED_SCREENS: readonly DocListScreen[] = ['recent', 'shared']

/** the date a grouping screen files a row under */
function groupInputOf(screen: DocListScreen, row: DocumentsHomeTableRow): GroupInput {
  if (row.type !== 'doc') return {}
  return { at: screen === 'recent' ? row.doc.lastActivity?.at : row.doc.shared?.at }
}

function SortArrow() {
  return (
    <svg
      className="dh-sort-arrow"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 8.5V1.5M2 4.5l3-3 3 3" />
    </svg>
  )
}

/**
 * The Documents table every list of the app shares: Chọn · Tên · [screen
 * column] · Truy cập · Người sửa gần nhất · Cập nhật · Dung lượng · Thao tác.
 * Headers sort (`aria-sort`), columns hide by the width of the table itself,
 * a screen column appears once a loaded row carries its field. The caller
 * owns loading, the row menus and what a row does.
 */
export function DocList({
  screen,
  rows,
  sort,
  onSortChange,
  selected,
  onSelectedChange,
  label,
  openingId,
  openMenuId,
  onOpenMenuChange,
  menuFor,
  actionsFor,
  onOpen,
  sublineFor,
  rename,
  renderSource,
}: DocListProps) {
  const { t } = useI18n()

  // width of the table the columns hide by (the table, not the window); 0 = not measured yet
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver((entries) => {
      const next = entries[entries.length - 1]?.contentRect.width
      if (typeof next === 'number') setWidth(next)
    })
    observer.current.observe(el)
  }, [])

  const docs = useMemo(() => rows.flatMap((row) => (row.type === 'doc' ? [row.doc] : [])), [rows])
  const present = specialPresent(screen, docs)
  const columns = visibleColumns(screen, docs, width > 0 ? width : undefined)
  const active = effectiveSort(screen, sort, present)
  const sorted = useMemo(
    () => sortTableRows(rows, active),
    // the sort object is rebuilt every render: its two parts are the dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, active.column, active.dir],
  )

  const track = trackOf(columns, screen)
  const now = new Date()
  const special = specialColumn(screen)

  // groups follow the screen column: only while it is there and the list is sorted by it
  const [collapsed, toggleGroup] = useCollapsedGroups(screen)
  const grouped = GROUPED_SCREENS.includes(screen) && present && groupsActive(screen, active)
  const runs = grouped ? groupRows(screen, sorted, now, (row) => groupInputOf(screen, row)) : null

  const allSelected = docs.length > 0 && docs.every((doc) => selected.has(doc.id))
  const someSelected = !allSelected && docs.some((doc) => selected.has(doc.id))
  const allRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someSelected
  }, [someSelected])

  const toggleOne = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    onSelectedChange(next)
  }

  const headerFor = (col: ColumnId) => {
    if (col === 'select') {
      return (
        <div
          key={col}
          role="columnheader"
          data-col={col}
          className="dh-col-select"
          aria-label={t('dlColSelect')}
        >
          <input
            ref={allRef}
            type="checkbox"
            className="dh-check"
            aria-label={t('dlColSelect')}
            checked={allSelected}
            disabled={docs.length === 0}
            onChange={(e) =>
              onSelectedChange(e.target.checked ? new Set(docs.map((d) => d.id)) : new Set())
            }
          />
        </div>
      )
    }
    const text = t(COLUMN_LABEL_KEY[col])
    const className = `dh-col-${col === 'editor' ? 'person' : col === 'updated' ? 'time' : col === special ? 'special' : col}`
    if (col === 'actions') {
      return (
        <div key={col} role="columnheader" data-col={col} className={className} aria-label={text} />
      )
    }
    if (!isSortable(screen, col)) {
      return (
        <div key={col} role="columnheader" data-col={col} className={className}>
          {text}
        </div>
      )
    }
    const here = active.column === col
    return (
      <div
        key={col}
        role="columnheader"
        data-col={col}
        className={className}
        aria-sort={here ? (active.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          className={`dh-sort-head${here ? ' sorted' : ''}${here && active.dir === 'desc' ? ' desc' : ''}`}
          onClick={() => onSortChange(nextSort(screen, active, col))}
        >
          <span>{text}</span>
          <SortArrow />
        </button>
      </div>
    )
  }

  const rowFor = (row: DocumentsHomeTableRow, inGroup: boolean) => {
    if (row.type === 'source') {
      return renderSource ? renderSource(row.source, columns) : null
    }
    const doc = row.doc
    return (
      <DocRow
        key={row.id}
        doc={doc}
        screen={screen}
        columns={columns}
        now={now}
        grouped={inGroup}
        selected={selected.has(doc.id)}
        onSelectedChange={(on) => toggleOne(doc.id, on)}
        opening={openingId === doc.id}
        subline={sublineFor?.(doc) ?? null}
        rename={rename && rename.docId === doc.id ? rename : null}
        actions={actionsFor?.(doc)}
        menu={menuFor(doc)}
        menuOpen={openMenuId === doc.id}
        onMenuOpenChange={(open) => onOpenMenuChange(open ? doc.id : null)}
        onOpen={onOpen}
      />
    )
  }

  return (
    <div ref={measure} className="dh-doc-table" role="table" aria-label={label}>
      <div className="dh-doc-head" role="row" style={{ gridTemplateColumns: track }}>
        {columns.map(headerFor)}
      </div>
      {runs
        ? runs.flatMap((run) => {
            const open = run.id === null || !collapsed.has(run.id)
            return [
              run.id !== null && (
                <GroupHeader
                  key={`group:${run.id}`}
                  id={run.id}
                  open={open}
                  onToggle={toggleGroup}
                />
              ),
              ...(open ? run.rows.map((row) => rowFor(row, true)) : []),
            ]
          })
        : sorted.map((row) => rowFor(row, false))}
    </div>
  )
}
