import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../locale'
import type { FolderMenuItem } from '../uniwork-folders/FolderMenu'
import type { DocumentsHomeDoc, DocumentsHomeTableRow } from '../uniwork-home/documents-home-model'
import { trackOf } from './cells'
import { COLUMN_LABEL_KEY, isSortable, nextSort, type ColumnId, type SortSpec } from './columns'
import { DocRow } from './DocRow'
import { GROUP_LABEL_KEY, groupRows, groupsActive, type GroupId, type RowGroup } from './groups'
import { readCollapsedGroups, toggleGroup } from './persist'
import { effectiveSort, sortTableRows, specialPresent, visibleColumns } from './table-model'

const SCREEN = 'trash'

export interface TrashListProps {
  /** the loaded trashed rows, in any order: the table sorts and groups them */
  rows: readonly DocumentsHomeTableRow[]
  /** the sort the person chose; null = Đã xóa, oldest deletion first (the rules' default) */
  sort: SortSpec | null
  onSortChange: (next: SortSpec) => void
  selected: ReadonlySet<string>
  onSelectedChange: (next: Set<string>) => void
  label: string
  openMenuId: string | null
  onOpenMenuChange: (id: string | null) => void
  menuFor: (doc: DocumentsHomeDoc) => FolderMenuItem[]
  /** a row's own buttons before its "…" (Khôi phục) */
  actionsFor?: (doc: DocumentsHomeDoc) => ReactNode
  onOpen: (doc: DocumentsHomeDoc) => void
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`dl-group-chevron${open ? '' : ' closed'}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
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
 * The Thùng rác table: the shared Documents columns with Đã xóa after Tên,
 * rows grouped into Sắp xóa vĩnh viễn (7 days left or fewer) and Còn trên 7
 * ngày. A group collapses from its header and the choice is remembered; the
 * groups are runs of the sorted list, so they show only while it is sorted by
 * Đã xóa (either way) and any other sort lists the rows flat. The default is
 * Đã xóa oldest first, which puts the rows about to go on top.
 */
export function TrashList({
  rows,
  sort,
  onSortChange,
  selected,
  onSelectedChange,
  label,
  openMenuId,
  onOpenMenuChange,
  menuFor,
  actionsFor,
  onOpen,
}: TrashListProps) {
  const { t } = useI18n()

  // width of the table the columns hide by; 0 = not measured yet
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

  const [collapsed, setCollapsed] = useState<readonly GroupId[]>(() => readCollapsedGroups(SCREEN))

  const docs = useMemo(() => rows.flatMap((row) => (row.type === 'doc' ? [row.doc] : [])), [rows])
  const present = specialPresent(SCREEN, docs)
  const columns = visibleColumns(SCREEN, docs, width > 0 ? width : undefined)
  const active = effectiveSort(SCREEN, sort, present)
  const sorted = useMemo(
    () => sortTableRows(rows, active),
    // the sort object is rebuilt every render: its two parts are the dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, active.column, active.dir],
  )
  const now = new Date()
  const groups: RowGroup<DocumentsHomeTableRow>[] = groupsActive(SCREEN, active)
    ? groupRows(SCREEN, sorted, now, (row) => ({
        purgeAfter: row.type === 'doc' ? row.doc.purgeAfter : undefined,
      }))
    : [{ id: null, rows: sorted }]

  const track = trackOf(columns, SCREEN)
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
    const className = `dh-col-${col === 'editor' ? 'person' : col === 'updated' ? 'time' : col === 'deleted' ? 'special' : col}`
    if (col === 'actions') {
      return (
        <div key={col} role="columnheader" data-col={col} className={className} aria-label={text} />
      )
    }
    if (!isSortable(SCREEN, col)) {
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
          onClick={() => onSortChange(nextSort(SCREEN, active, col))}
        >
          <span>{text}</span>
          <SortArrow />
        </button>
      </div>
    )
  }

  const rowFor = (row: DocumentsHomeTableRow) => {
    if (row.type !== 'doc') return null
    const doc = row.doc
    return (
      <DocRow
        key={row.id}
        doc={doc}
        screen={SCREEN}
        columns={columns}
        now={now}
        selected={selected.has(doc.id)}
        onSelectedChange={(on) => toggleOne(doc.id, on)}
        opening={false}
        subline={null}
        rename={null}
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
      {groups.map((group) => {
        if (group.id === null) return group.rows.map(rowFor)
        const id = group.id
        const open = !collapsed.includes(id)
        const name = t(GROUP_LABEL_KEY[id])
        return [
          <div key={`head:${id}`} role="row" data-group={id} className="dl-group-row">
            <div role="rowheader" aria-colspan={columns.length} className="dl-group-head">
              <button
                type="button"
                className="dl-group-toggle"
                aria-expanded={open}
                aria-label={t('dlGroupToggle', { group: name })}
                onClick={() => setCollapsed(toggleGroup(SCREEN, id))}
              >
                <Chevron open={open} />
                <span className="dl-group-name">{name}</span>
                <span className="dl-group-count">· {group.rows.length}</span>
              </button>
            </div>
          </div>,
          open ? (
            <div key={`body:${id}`} role="rowgroup" data-group-body={id}>
              {group.rows.map(rowFor)}
            </div>
          ) : null,
        ]
      })}
    </div>
  )
}
