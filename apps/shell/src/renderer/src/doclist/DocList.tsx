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
import { DocRow, type DocRowExtra, type DocRowRename, type DocSubline } from './DocRow'
import { GroupHeader } from './GroupHeader'
import { groupRows, groupsActive, type GroupId, type GroupInput } from './groups'
import { useCollapsedGroups } from './use-collapsed-groups'
import { effectiveSort, sortTableRows, specialPresent, visibleColumns } from './table-model'

export interface DocListProps {
  screen: DocListScreen
  /** the loaded rows, in any order: the table sorts them */
  rows: readonly DocumentsHomeTableRow[]
  /** more rows wait on the next page: the last group is partial, so it shows no count */
  moreToLoad?: boolean
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
  /** false lists the rows flat on a screen that groups (Trash search hits carry no purge date) */
  groups?: boolean
  /**
   * No sort applies until the person picks one: the rows stay in the order given and no
   * header shows a sort state (the device list keeps its last-opened order). The first
   * click still starts from the screen default, as a click on an applied default would.
   */
  unsortedDefault?: boolean
  /** folder rows stay above the files under any sort (the device folder view) */
  foldersFirst?: boolean
  /**
   * Which rows carry a Chọn box. A row it refuses has none and select-all skips it; when
   * it refuses every row the Chọn column is not drawn at all. Default: every row.
   */
  selectableFor?: (doc: DocumentsHomeDoc) => boolean
  /** a row's own class and drag, drop and context-menu events */
  rowPropsFor?: (doc: DocumentsHomeDoc) => DocRowExtra | undefined
  /** the name's text when it is more than the title (a highlighted search hit) */
  titleFor?: (doc: DocumentsHomeDoc) => ReactNode
}

/** the screens whose rows fall in groups under their own column: day / week, or days left in the Trash */
const GROUPED_SCREENS: readonly DocListScreen[] = ['recent', 'shared', 'trash']

/** what a grouping screen files a row under: a date, or the purge date in the Trash */
function groupInputOf(screen: DocListScreen, row: DocumentsHomeTableRow): GroupInput {
  if (row.type !== 'doc') return {}
  if (screen === 'trash') return { purgeAfter: row.doc.purgeAfter }
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
  moreToLoad = false,
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
  groups = true,
  unsortedDefault = false,
  foldersFirst = false,
  selectableFor,
  rowPropsFor,
  titleFor,
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
  const canSelect = (doc: DocumentsHomeDoc): boolean => !selectableFor || selectableFor(doc)
  const selectableDocs = docs.filter(canSelect)
  const allColumns = visibleColumns(screen, docs, width > 0 ? width : undefined)
  // a list nothing on is selectable has no Chọn column
  const columns =
    selectableFor && selectableDocs.length === 0
      ? allColumns.filter((c) => c !== 'select')
      : allColumns
  const effective = effectiveSort(screen, sort, present)
  const active: SortSpec | null = unsortedDefault && !sort ? null : effective
  const sorted = useMemo(
    () => {
      const ordered = active ? sortTableRows(rows, active) : [...rows]
      if (!foldersFirst) return ordered
      const isFolder = (row: DocumentsHomeTableRow) =>
        row.type === 'doc' && row.doc.kind === 'folder'
      return [...ordered.filter(isFolder), ...ordered.filter((row) => !isFolder(row))]
    },
    // the sort object is rebuilt every render: its two parts are the dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, active?.column, active?.dir, foldersFirst],
  )

  const track = trackOf(columns, screen)
  const now = new Date()
  const special = specialColumn(screen)

  // groups follow the screen column: only while it is there and the list is sorted by it
  const [collapsed, toggleGroup] = useCollapsedGroups(screen)
  const grouped =
    groups && GROUPED_SCREENS.includes(screen) && present && active && groupsActive(screen, active)
  const runs = grouped ? groupRows(screen, sorted, now, (row) => groupInputOf(screen, row)) : null

  // select-all and the header box stand for the rows on screen: a closed group's rows are not
  const docsOf = (rows: readonly DocumentsHomeTableRow[]) =>
    rows.flatMap((row) => (row.type === 'doc' ? [row.doc] : []))
  const shownDocs = runs
    ? runs.flatMap((run) =>
        run.id === null || !collapsed.has(run.id) ? docsOf(run.rows).filter(canSelect) : [],
      )
    : selectableDocs
  const allSelected = shownDocs.length > 0 && shownDocs.every((doc) => selected.has(doc.id))
  const someSelected = !allSelected && shownDocs.some((doc) => selected.has(doc.id))
  const allRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someSelected
  }, [someSelected])

  // closing a group takes its rows out of the selection: the bar must not count rows nobody sees
  const onToggleGroup = (id: GroupId) => {
    const run = runs?.find((candidate) => candidate.id === id)
    if (run && !collapsed.has(id)) {
      const hidden = docsOf(run.rows).filter((doc) => selected.has(doc.id))
      if (hidden.length > 0) {
        const next = new Set(selected)
        for (const doc of hidden) next.delete(doc.id)
        onSelectedChange(next)
      }
    }
    toggleGroup(id)
  }

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
            disabled={shownDocs.length === 0}
            onChange={(e) =>
              onSelectedChange(e.target.checked ? new Set(shownDocs.map((d) => d.id)) : new Set())
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
    const here = active?.column === col
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
          onClick={() => onSortChange(nextSort(screen, active ?? effective, col))}
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
        selectable={canSelect(doc)}
        titleNode={titleFor?.(doc)}
        extra={rowPropsFor?.(doc)}
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
        ? runs.flatMap((run, index) => {
            const open = run.id === null || !collapsed.has(run.id)
            return [
              run.id !== null && (
                <GroupHeader
                  key={`group:${run.id}`}
                  id={run.id}
                  open={open}
                  count={moreToLoad && index === runs.length - 1 ? undefined : run.rows.length}
                  onToggle={onToggleGroup}
                />
              ),
              open ? (
                <div
                  key={`body:${run.id}`}
                  role="rowgroup"
                  className="dh-group-body"
                  data-group-body={run.id ?? undefined}
                >
                  {run.rows.map((row) => rowFor(row, true))}
                </div>
              ) : null,
            ]
          })
        : sorted.map((row) => rowFor(row, false))}
    </div>
  )
}
