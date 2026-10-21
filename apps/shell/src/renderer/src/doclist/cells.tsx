// The cells of a Documents table row, one component per column kind. Rows
// (DocRow, DocumentsSourceRow) lay them out in the order `visibleColumns`
// gives; every cell is a `role="cell"` carrying its column id.
import type { MouseEvent, ReactNode } from 'react'
import { useI18n } from '../locale'
import { shelverLabelOf, type DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import { ACCESS_PILL_KEY, accessPill, levelLine } from './access'
import {
  BUTTON_ACTIONS_WIDTH,
  hasButtonActions,
  type ColumnId,
  type DocListScreen,
  type SpecialColumnId,
} from './columns'
import { EMPTY_CELL, formatDaysLeft, formatListDate } from './format'
import { DELETING_SOON_DAYS, daysLeft } from './groups'
import { editorInitials, editorNameOf } from './table-model'

/**
 * Grid track of each column. The fixed widths are the ones `columns.ts` builds
 * its narrow ladder on (cell padding included); Tên takes what is left.
 */
const TRACK: Record<ColumnId, string> = {
  select: '32px',
  name: 'minmax(184px, 3fr)',
  activity: 'minmax(118px, 1.3fr)',
  starred: 'minmax(118px, 1.3fr)',
  shared: 'minmax(118px, 1.3fr)',
  shared_with: 'minmax(118px, 1.3fr)',
  shelved: 'minmax(118px, 1.3fr)',
  deleted: 'minmax(118px, 1.3fr)',
  access: 'minmax(120px, 1fr)',
  editor: 'minmax(130px, 1.1fr)',
  updated: '118px',
  size: '84px',
  actions: '76px',
}

/** the shelf's row carries a Bỏ lưu trữ button and the trash row a Khôi phục button before its "…": their actions column is wider (columns.ts counts the same width in its ladder) */
const BUTTON_ACTIONS_TRACK = `${BUTTON_ACTIONS_WIDTH}px`

export function trackOf(columns: readonly ColumnId[], screen?: DocListScreen): string {
  return columns
    .map((column) =>
      column === 'actions' && screen && hasButtonActions(screen)
        ? BUTTON_ACTIONS_TRACK
        : TRACK[column],
    )
    .join(' ')
}

const CELL_CLASS: Record<ColumnId, string> = {
  select: 'dh-cell-select',
  name: 'dh-cell-name',
  activity: 'dh-cell-special',
  starred: 'dh-cell-special',
  shared: 'dh-cell-special',
  shared_with: 'dh-cell-special',
  shelved: 'dh-cell-special',
  deleted: 'dh-cell-special',
  access: 'dh-cell-access',
  editor: 'dh-cell-person',
  updated: 'dh-cell-time',
  size: 'dh-cell-size',
  actions: 'dh-cell-actions',
}

/** a table cell of a column: its class and `data-col`, so the grid and the tests find it */
export function Cell({
  col,
  children,
  className,
  onClick,
  onDoubleClick,
}: {
  col: ColumnId
  children?: ReactNode
  className?: string
  onClick?: (e: MouseEvent) => void
  onDoubleClick?: (e: MouseEvent) => void
}) {
  return (
    <div
      role="cell"
      data-col={col}
      className={className ? `${CELL_CLASS[col]} ${className}` : CELL_CLASS[col]}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </div>
  )
}

export function Empty() {
  return <span className="dh-cell-empty">{EMPTY_CELL}</span>
}

/** the Truy cập pill (Riêng tư / Workspace / Được chia sẻ) and the line under it (Chủ sở hữu / Bạn: Sửa) */
export function AccessContent({ doc }: { doc: DocumentsHomeDoc }) {
  const { t } = useI18n()
  const pill = accessPill(doc)
  const level = levelLine(doc, t)
  return (
    <>
      <span className={`dh-vis-badge dh-vis-${pill}`}>{t(ACCESS_PILL_KEY[pill])}</span>
      {level && <span className="dh-level-sub">{level}</span>}
    </>
  )
}

/**
 * An avatar and a name. The avatar is the initials: the renderer's content
 * security policy lets no remote image in, so `avatar_url` is parsed by main
 * but never drawn.
 */
export function Person({ name }: { name: string | null }) {
  if (!name) return <Empty />
  return (
    <>
      <span className="dh-avatar" aria-hidden="true">
        {editorInitials(name)}
      </span>
      <span className="dh-person-name" title={name}>
        {name}
      </span>
    </>
  )
}

export function EditorContent({ doc }: { doc: DocumentsHomeDoc }) {
  return <Person name={editorNameOf(doc)} />
}

/** two lines: the main text and a muted 12px line under it */
export function Stack({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return (
    <span className="dh-special">
      <span className="dh-special-main">{main}</span>
      {sub ? <span className="dh-special-sub">{sub}</span> : null}
    </span>
  )
}

/** the screen columns that have their own cell in special-cells.tsx */
export type OwnSpecialColumn = 'activity' | 'shared' | 'shared_with'

/**
 * The screen column of a row on the screens without a cell of their own
 * (special-cells.tsx has Recent, Shared with me and Shared by me): what the
 * screen is about. A row without the field reads "—" (the column is only
 * drawn once some loaded row has it).
 */
export function SpecialContent({
  column,
  doc,
  now,
}: {
  column: Exclude<SpecialColumnId, OwnSpecialColumn>
  doc: DocumentsHomeDoc
  now: Date
}) {
  const { t, dateLocale } = useI18n()
  const date = (at: string | undefined) => formatListDate(at, now, dateLocale, t)
  switch (column) {
    case 'starred':
      return doc.favoritedAt ? (
        <Stack main={date(doc.favoritedAt)} sub={t('dlStarredByYou')} />
      ) : (
        <Empty />
      )
    case 'shelved': {
      if (!doc.shelvedAt) return <Empty />
      const by = shelverLabelOf(doc, t)
      return (
        <Stack
          main={by ? doc.shelvedByName?.trim() ? <Person name={by} /> : by : EMPTY_CELL}
          sub={date(doc.shelvedAt)}
        />
      )
    }
    case 'deleted': {
      if (!doc.archivedAt) return <Empty />
      const left = formatDaysLeft(doc.purgeAfter, now, t)
      const soon = (daysLeft(doc.purgeAfter, now) ?? Infinity) <= DELETING_SOON_DAYS
      return (
        <Stack
          main={doc.archivedByName?.trim() || EMPTY_CELL}
          sub={
            <>
              {date(doc.archivedAt)}
              {left && (
                <>
                  {' · '}
                  <span className={soon ? 'dh-days-left dh-days-soon' : 'dh-days-left'}>
                    {left}
                  </span>
                </>
              )}
            </>
          }
        />
      )
    }
  }
}
