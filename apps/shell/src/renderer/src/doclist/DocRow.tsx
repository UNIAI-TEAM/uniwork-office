import type { ReactNode } from 'react'
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
import { AccessContent, Cell, EditorContent, trackOf } from './cells'
import { specialColumn, type ColumnId, type DocListScreen } from './columns'
import { formatBytes, formatListDate } from './format'
import { SpecialCell } from './special-cells'

/** the second line under a name: where the row sits (a path), or which workspace shared it */
export interface DocSubline {
  short: string
  full: string
  /** a folder path: it reads its full form to a screen reader */
  path?: boolean
}

export interface DocRowRename {
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
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  opening: boolean
  subline: DocSubline | null
  /** this row is being renamed in place */
  rename: DocRowRename | null
  /** the row's own buttons before its "…" (the shelf's Bỏ lưu trữ) */
  actions?: ReactNode
  menu: FolderMenuItem[]
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onOpen: (doc: DocumentsHomeDoc) => void
}

/** One document row of the shared Documents table. */
export function DocRow({
  doc,
  screen,
  columns,
  now,
  grouped,
  selected,
  onSelectedChange,
  opening,
  subline,
  rename,
  actions,
  menu,
  menuOpen,
  onMenuOpenChange,
  onOpen,
}: DocRowProps) {
  const { t, dateLocale } = useI18n()
  const folder = isFolderEntry(doc)
  const special = specialColumn(screen)
  const cellFor = (col: ColumnId) => {
    switch (col) {
      case 'select':
        return (
          <Cell key={col} col={col}>
            <input
              type="checkbox"
              className="dh-check"
              aria-label={`${t('dlColSelect')} ${doc.title}`}
              checked={selected}
              onChange={(e) => onSelectedChange(e.target.checked)}
            />
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
              <FileBadge ext={doc.kind === 'page' ? 'page' : docExtension(doc)} size={28} />
            )}
            {rename ? (
              <RenameField
                initial={renameParts(doc.title, renameFormatOf(doc)).base}
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
                {folder ? (
                  <span className="dh-doc-title" title={doc.title}>
                    {doc.title}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="dh-doc-open"
                    title={doc.title}
                    onClick={() => onOpen(doc)}
                  >
                    {doc.title}
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
                      subline.short
                    )}
                  </span>
                )}
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
          <Cell key={col} col={col} onClick={(e) => e.stopPropagation()}>
            {actions}
            {menu.length > 0 && (
              <FolderMenu
                label={t('ufActionsFor', { name: doc.title })}
                items={menu}
                dataFor={doc.id}
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
      className={`dh-doc-row${grouped ? ' grouped' : ''}${opening ? ' opening' : ''}${selected ? ' selected' : ''}`}
      style={{ gridTemplateColumns: trackOf(columns, screen) }}
      onDoubleClick={() => {
        if (!rename && !folder) onOpen(doc)
      }}
    >
      {columns.map(cellFor)}
    </div>
  )
}
