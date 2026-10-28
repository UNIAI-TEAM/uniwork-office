// The cells of a Documents table row, one component per column kind. Rows
// (DocRow, DocumentsSourceRow) lay them out in the order `visibleColumns`
// gives; every cell is a `role="cell"` carrying its column id.
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useI18n } from '../locale'
import { shelverLabelOf, type DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import { ACCESS_PILL_KEY, accessPill, levelLine, type AccessPill } from './access'
import {
  BUTTON_ACTIONS_WIDTH,
  COMPACT_WIDTH,
  hasButtonActions,
  showsRowButton,
  type ColumnId,
  type DocListScreen,
  type SpecialColumnId,
} from './columns'
import { EMPTY_CELL, formatDaysLeft, formatListDate } from './format'
import { DELETING_SOON_DAYS, daysLeft } from './groups'
import { accessCellName, canShareRow } from './share-gate'
import { editorAvatarUrlOf, editorInitials, editorNameOf } from './table-model'
import './access-button.css'

/** the file / folder icon box of a table row (doclist-canvas: 32px on every screen) */
export const DOC_ICON_SIZE = 32

/**
 * Grid track of each column. The fixed widths are the ones `columns.ts` builds
 * its narrow ladder on (cell padding included); Tên takes what is left.
 * V-LAYOUT F-06: Người sửa gần nhất takes 18px more than the ladder counts (the vi header "Người sửa
 * gần nhất" + its cell padding is ~136px) and Tên's grid floor gives the same 18px back, so the sum
 * of the floors, and every rung of the ladder (the web's), is unchanged.
 * V-FIX3 N-03b: Dung lượng takes 8px more (92px: the 12px semibold label measured ~72px, past the
 * 68px content box and still ellipsised), Tên's floor gives the 8px back (158 instead of 166).
 */
const TRACK: Record<ColumnId, string> = {
  select: '32px',
  name: 'minmax(158px, 3fr)',
  activity: 'minmax(118px, 1.3fr)',
  starred: 'minmax(118px, 1.3fr)',
  shared: 'minmax(118px, 1.3fr)',
  shared_with: 'minmax(118px, 1.3fr)',
  shelved: 'minmax(118px, 1.3fr)',
  deleted: 'minmax(160px, 1.5fr)',
  access: 'minmax(120px, 1fr)',
  editor: 'minmax(148px, 1.1fr)',
  updated: '118px',
  size: '92px',
  actions: '76px',
}

/** the shelf's row carries a Bỏ lưu trữ button and the trash row a Khôi phục button before its "…": their actions column is wider (columns.ts counts the same width in its ladder) */
const BUTTON_ACTIONS_TRACK = `${BUTTON_ACTIONS_WIDTH}px`

/**
 * The Starred screen's actions track while its rows draw the Sao button: 76px, which holds Sao 28 +
 * gap 4 + "…" 28 on a fine pointer, and the width documents-home.css sets on `--dh-star-actions-track`
 * for the two 44px buttons of a coarse pointer
 */
const STAR_ACTIONS_TRACK = 'var(--dh-star-actions-track, 76px)'

/**
 * `compact` is the table below the ladder (columns.ts `isCompact`): Tên takes what the fixed tracks
 * leave, Cập nhật is a narrow track whose date wraps, and the button screens' actions track shrinks.
 */
/** whether the table the rows are in is below the ladder (DocList provides it; rows read it for their grid) */
export const CompactTableContext = createContext(false)
export const useCompactTable = (): boolean => useContext(CompactTableContext)

export function trackOf(
  columns: readonly ColumnId[],
  screen?: DocListScreen,
  star = false,
  compact = false,
): string {
  return columns
    .map((column) => {
      if (compact && column === 'name') return `minmax(${COMPACT_WIDTH.name}px, 1fr)`
      if (compact && column === 'updated') return `${COMPACT_WIDTH.updated}px`
      if (column !== 'actions') return TRACK[column]
      if (screen && hasButtonActions(screen)) {
        if (!compact) return BUTTON_ACTIONS_TRACK
        return showsRowButton(screen, true) ? `${COMPACT_WIDTH.buttonActions}px` : TRACK[column]
      }
      return star ? STAR_ACTIONS_TRACK : TRACK[column]
    })
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

function AccessPillIcon({ pill }: { pill: AccessPill }) {
  return (
    <svg
      className="dh-vis-icon"
      data-icon="inline-start"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {pill === 'restricted' ? (
        <>
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </>
      ) : pill === 'workspace' ? (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      ) : (
        <>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
          <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
        </>
      )}
    </svg>
  )
}

/**
 * The Truy cập pill (Riêng tư / Workspace / Được chia sẻ) and the line under it (Chủ sở hữu / Bạn: Sửa);
 * nothing for a folder.
 * On a row that passes the Share gate (`onShare` given) the pill and the line are ONE button that
 * opens the Share dialog without opening the document; a manager reads "Quản lý quyền truy cập của …",
 * anyone else "Xem quyền truy cập của …". The name is the command plus the visible text (label in
 * name). Any other row stays text.
 */
export function AccessContent({
  doc,
  onShare,
}: {
  doc: DocumentsHomeDoc
  onShare?: (doc: DocumentsHomeDoc) => void
}) {
  const { t } = useI18n()
  const commandId = useId()
  const contentId = useId()
  // UNI-2066: a folder has no access of its own to show (workspace folders are open to every
  // member, the documents inside keep theirs), so its cell stays empty
  if (doc.kind === 'folder') return null
  const pill = accessPill(doc)
  const level = levelLine(doc, t)
  const content = (
    <>
      <span className={`dh-vis-badge dh-vis-${pill}`} data-access-kind={pill}>
        <AccessPillIcon pill={pill} />
        <span className="dh-vis-label">{t(ACCESS_PILL_KEY[pill])}</span>
      </span>
      {level && (
        <>
          {/* the accessible name concatenates inline spans: keep the pill and the line apart */}
          <span className="uw-sr-only">{', '}</span>
          <span className="dh-level-sub">{level}</span>
        </>
      )}
    </>
  )
  if (!onShare || !canShareRow(doc)) return content
  return (
    <button
      type="button"
      className="dh-access-btn"
      data-access-share
      aria-labelledby={`${commandId} ${contentId}`}
      onClick={(e) => {
        e.stopPropagation()
        onShare(doc)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span id={commandId} className="uw-sr-only">
        {t(accessCellName(doc) === 'manage' ? 'shrAccessManageFor' : 'shrAccessViewFor', {
          title: doc.title,
        })}
      </span>
      <span id={contentId} className="dh-access-btn-content">
        {content}
      </span>
    </button>
  )
}

/**
 * An avatar and a name: renders the photo from `avatar_url` when available,
 * falling back to the person's initials if absent or if the image fails to load.
 */
export function Person({ name, avatarUrl }: { name: string | null; avatarUrl?: string | null }) {
  const [imgError, setImgError] = useState(false)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    setImgError(false)
  }, [avatarUrl])
  useEffect(() => {
    const el = imgRef.current
    if (!el || !avatarUrl) return
    if (el.complete && el.naturalWidth > 0) setLoadedSrc(avatarUrl)
  }, [avatarUrl])
  if (!name) return <Empty />
  const cleanUrl = avatarUrl?.trim() || null
  const photo = Boolean(cleanUrl) && !imgError
  const loaded = photo && loadedSrc === cleanUrl
  return (
    <>
      <span className="dh-avatar" data-slot="avatar" aria-hidden="true">
        <span className={`dh-avatar-initials${loaded ? ' is-hidden' : ''}`}>
          {editorInitials(name)}
        </span>
        {photo && (
          <img
            ref={imgRef}
            src={cleanUrl ?? undefined}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
            className={`dh-avatar-img${loaded ? ' is-loaded' : ''}`}
            onLoad={() => setLoadedSrc(cleanUrl)}
            onError={() => setImgError(true)}
          />
        )}
      </span>
      <span className="dh-person-name" title={name}>
        {name}
      </span>
    </>
  )
}

export function EditorContent({ doc }: { doc: DocumentsHomeDoc }) {
  return <Person name={editorNameOf(doc)} avatarUrl={editorAvatarUrlOf(doc)} />
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

/**
 * V-FIX2 N-02: what the Đã xóa column says (who, date, "Còn N ngày") as the one line under Tên of a
 * Trash row that has no such column (the web's narrow row). Who gives way first, then the date: the
 * countdown, the one datum of the page, is never cut.
 */
export function DeletedLine({ doc, now }: { doc: DocumentsHomeDoc; now: Date }) {
  const { t, dateLocale } = useI18n()
  if (!doc.archivedAt) return null
  const who = doc.archivedByName?.trim()
  const left = formatDaysLeft(doc.purgeAfter, now, t)
  const soon = (daysLeft(doc.purgeAfter, now) ?? Infinity) <= DELETING_SOON_DAYS
  return (
    <span className="dh-deleted-line">
      {who && (
        <>
          <span className="dh-deleted-who">{who}</span>
          <span className="dh-deleted-sep">{' · '}</span>
        </>
      )}
      <span className="dh-deleted-date">{formatListDate(doc.archivedAt, now, dateLocale, t)}</span>
      {left && (
        <>
          <span className="dh-deleted-sep">{' · '}</span>
          <span className={`dh-deleted-countdown dh-days-left${soon ? ' dh-days-soon' : ''}`}>
            {left}
          </span>
        </>
      )}
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
            // the date gives way (ellipsis) before the countdown does
            <span className="dh-deleted-sub">
              <span className="dh-deleted-date">{date(doc.archivedAt)}</span>
              {left && (
                <>
                  <span className="dh-deleted-sep">{' · '}</span>
                  <span
                    className={`dh-deleted-countdown dh-days-left${soon ? ' dh-days-soon' : ''}`}
                  >
                    {left}
                  </span>
                </>
              )}
            </span>
          }
        />
      )
    }
  }
}
