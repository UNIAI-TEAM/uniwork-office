import type { DragEvent, MouseEvent, ReactNode } from 'react'
import { FileBadge } from '../FileBadge'
import { useI18n } from '../locale'
import { RenameField } from '../UniworkDocActions'
import {
  DOC_NAME_ERROR_KEYS,
  docExtension,
  renameFormatOf,
  renameParts,
  type DocNameError,
} from '../uniwork-docs-model'
import { FolderMenu, type FolderMenuItem } from '../uniwork-folders/FolderMenu'
import { FolderGlyph } from '../uniwork-folders/UniworkFolderTree'
import { isFolderEntry } from '../uniwork-folders/uniwork-folders-model'
import { rowSizeBytes, type DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import { AccessContent, Cell, DOC_ICON_SIZE, EditorContent, trackOf } from './cells'
import { specialColumn, type ColumnId, type DocListScreen } from './columns'
import { formatBytes, formatListDate } from './format'
import { SpecialCell } from './special-cells'

/** the second line under a name: where the row sits (a path), or which workspace shared it */
export interface DocSubline {
  short: string
  full: string
  /** a folder path: it reads its full form to a screen reader */
  path?: boolean
  /** drawn in place of `short` (a badge, highlighted text) */
  node?: ReactNode
  /** one more line under the second line (a search hit's snippet) */
  detail?: ReactNode
}

/** what a caller may add to a row: its class and the drag, drop and context events */
export interface DocRowExtra {
  className?: string
  draggable?: boolean
  onDragStart?: (event: DragEvent) => void
  onDragOver?: (event: DragEvent) => void
  onDragLeave?: (event: DragEvent) => void
  onDrop?: (event: DragEvent) => void
  onContextMenu?: (event: MouseEvent) => void
}

export interface DocRowRename {
  /** the name the field starts with; default = the title without its extension */
  initial?: string
  error: DocNameError | null
  busy: boolean
  onSave: (value: string) => void
  onCancel: () => void
  onEdit: () => void
}

export interface DocRowProps {
  doc: DocumentsHomeDoc
  screen: DocListScreen
  columns: readonly ColumnId[]
  now: Date
  /** the row sits under a group header: it is indented */
  grouped?: boolean
  /** false draws no Chọn box on the row (a folder or a UniWork copy on the device list) */
  selectable?: boolean
  /** the name's text when it is more than the title (a highlighted search hit) */
  titleNode?: ReactNode
  extra?: DocRowExtra
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  opening: boolean
  subline: DocSubline | null
  /** this row is being renamed in place */
  rename: DocRowRename | null
  /** the row's own buttons before its "…" (the shelf's Bỏ lưu trữ) */
  actions?: ReactNode
  /**
   * Bỏ gắn sao from the row's Sao button. The button is drawn only when this is given and the row
   * knows it is starred (only the Starred list carries the star time): never a dead toggle.
   */
  onUnstar?: (doc: DocumentsHomeDoc) => void
  menu: FolderMenuItem[]
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onOpen: (doc: DocumentsHomeDoc) => void
}

/** the filled star of the Sao button (doclist-canvas Rules: "Sao · ⋯"); its colour is the button's */
function StarGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** One document row of the shared Documents table. */
export function DocRow({
  doc,
  screen,
  columns,
  now,
  grouped,
  selectable = true,
  titleNode,
  extra,
  selected,
  onSelectedChange,
  opening,
  subline,
  rename,
  actions,
  onUnstar,
  menu,
  menuOpen,
  onMenuOpenChange,
  onOpen,
}: DocRowProps) {
  const { t, dateLocale } = useI18n()
  const folder = isFolderEntry(doc)
  // a folder never opens from its row (the device list enters it), and a trashed file has no Mở in its menu either
  const opens = (!folder || screen === 'device') && screen !== 'trash' && !doc.archived
  const special = specialColumn(screen)
  const cellFor = (col: ColumnId) => {
    switch (col) {
      case 'select':
        return (
          <Cell key={col} col={col}>
            {selectable && (
              <input
                type="checkbox"
                className="dh-check"
                aria-label={`${t('dlColSelect')} ${doc.title}`}
                checked={selected}
                onChange={(e) => onSelectedChange(e.target.checked)}
              />
            )}
          </Cell>
        )
      case 'name':
        return (
          <Cell key={col} col={col}>
            {folder ? (
              <span className="dh-folder-icon" aria-hidden="true">
                <FolderGlyph />
              </span>
            ) : (
              <FileBadge
                ext={doc.kind === 'page' ? 'page' : docExtension(doc)}
                size={DOC_ICON_SIZE}
              />
            )}
            {rename ? (
              <RenameField
                initial={rename.initial ?? renameParts(doc.title, renameFormatOf(doc)).base}
                label={doc.title}
                error={rename.error}
                busy={rename.busy}
                errorKeys={DOC_NAME_ERROR_KEYS}
                onSave={rename.onSave}
                onCancel={rename.onCancel}
                onEdit={rename.onEdit}
              />
            ) : (
              <div className="dh-name-stack">
                {!opens ? (
                  <span className="dh-doc-title" title={doc.title}>
                    {titleNode ?? doc.title}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="dh-doc-open"
                    title={doc.title}
                    onClick={() => onOpen(doc)}
                  >
                    {titleNode ?? doc.title}
                  </button>
                )}
                {subline && (
                  <span
                    className={`dh-doc-subpath${subline.path ? ' uwf-path' : ''}`}
                    title={subline.full}
                  >
                    {subline.path ? (
                      <>
                        <span aria-hidden="true">{subline.short}</span>
                        <span className="uw-sr-only">
                          {t('ufPathLabel', { path: subline.full })}
                        </span>
                      </>
                    ) : (
                      (subline.node ?? subline.short)
                    )}
                  </span>
                )}
                {subline?.detail}
              </div>
            )}
          </Cell>
        )
      case 'access':
        return (
          <Cell key={col} col={col}>
            <AccessContent doc={doc} />
          </Cell>
        )
      case 'editor':
        return (
          <Cell key={col} col={col}>
            <EditorContent doc={doc} />
          </Cell>
        )
      case 'updated':
        return (
          <Cell key={col} col={col}>
            {formatListDate(doc.updatedAt, now, dateLocale, t)}
          </Cell>
        )
      case 'size':
        return (
          <Cell key={col} col={col}>
            {formatBytes(rowSizeBytes({ type: 'doc', id: doc.id, doc }), dateLocale)}
          </Cell>
        )
      case 'actions':
        return (
          <Cell
            key={col}
            col={col}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {onUnstar && doc.favoritedAt && (
              <button
                type="button"
                className="dh-row-btn dh-star-btn"
                aria-label={`${t('dlActUnstar')} ${doc.title}`}
                title={t('dlActUnstar')}
                onClick={() => onUnstar(doc)}
              >
                <StarGlyph />
              </button>
            )}
            {actions}
            {menu.length > 0 && (
              <FolderMenu
                label={t('ufActionsFor', { name: doc.title })}
                items={menu}
                dataFor={doc.id}
                tabbable
                open={menuOpen}
                onOpenChange={onMenuOpenChange}
              />
            )}
          </Cell>
        )
      default:
        // the screen column; the table only lists it when it is this screen's own
        return col === special ? (
          <Cell key={col} col={col}>
            <SpecialCell column={col} doc={doc} now={now} />
          </Cell>
        ) : null
    }
  }

  return (
    <div
      role="row"
      data-doc-id={doc.id}
      aria-selected={selected || undefined}
      aria-busy={opening || undefined}
      className={`dh-doc-row${grouped ? ' grouped' : ''}${opening ? ' opening' : ''}${selected ? ' selected' : ''}${extra?.className ? ` ${extra.className}` : ''}`}
      style={{ gridTemplateColumns: trackOf(columns, screen, screen === 'starred' && !!onUnstar) }}
      draggable={extra?.draggable}
      onDragStart={extra?.onDragStart}
      onDragOver={extra?.onDragOver}
      onDragLeave={extra?.onDragLeave}
      onDrop={extra?.onDrop}
      onContextMenu={extra?.onContextMenu}
      onDoubleClick={() => {
        if (!rename && opens) onOpen(doc)
      }}
    >
      {columns.map(cellFor)}
    </div>
  )
}
