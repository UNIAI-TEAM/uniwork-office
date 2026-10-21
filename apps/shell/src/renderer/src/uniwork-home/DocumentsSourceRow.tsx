import type { UniworkSourceFile } from '../../../shared/home-api'
import { FileBadge } from '../FileBadge'
import { useI18n } from '../locale'
import { FolderMenu } from '../uniwork-folders/FolderMenu'
import { Cell, DOC_ICON_SIZE, Empty, Person, trackOf, useCompactTable } from '../doclist/cells'
import type { ColumnId } from '../doclist/columns'
import { formatBytes, formatListDate } from '../doclist/format'
import { openable } from './source-open-model'

/** UNI-1961: a source file's badge format: its extension, else its name's */
function sourceExtension(source: UniworkSourceFile): string {
  const ext = source.extension.toLowerCase().replace(/^\./, '')
  if (ext) return ext
  const dot = source.name.lastIndexOf('.')
  return dot > 0 ? source.name.slice(dot + 1).toLowerCase() : ''
}

/**
 * UNI-1961: one "other sources" row of the Documents table - a file attached
 * in chat, a task, a meeting or email, listed beside the documents as the web
 * does (D documents-library-row.tsx). It has no level or scope (Access "—"),
 * its editor is the owner. Its primary action (the name, Enter, a double click)
 * is the web's: Open (view only) when the server and an editor module allow it
 * (UNI-1993), else Download; the menu lists Open first, then Download.
 */
export function DocumentsSourceRow({
  source,
  columns,
  menuOpen,
  onMenuOpenChange,
  onOpen,
  onDownload,
}: {
  source: UniworkSourceFile
  /** the columns of the table it sits in, in order */
  columns: readonly ColumnId[]
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onOpen: (source: UniworkSourceFile) => void
  onDownload: (source: UniworkSourceFile) => void
}) {
  const { t, dateLocale } = useI18n()
  const compact = useCompactTable()
  const owner = source.owner?.name.trim() ?? ''
  const download = () => onDownload(source)
  const canOpen = openable(source)
  const open = () => onOpen(source)
  const primary = canOpen ? open : download
  const cellFor = (col: ColumnId) => {
    switch (col) {
      case 'name':
        return (
          <Cell key={col} col={col}>
            <FileBadge ext={sourceExtension(source)} size={DOC_ICON_SIZE} />
            <div className="dh-name-stack">
              <button type="button" className="dh-doc-open" title={source.name} onClick={primary}>
                {source.name}
              </button>
            </div>
          </Cell>
        )
      case 'editor':
        return (
          <Cell key={col} col={col}>
            <Person name={owner || null} />
          </Cell>
        )
      case 'updated':
        return (
          <Cell key={col} col={col}>
            {formatListDate(source.updatedAt, new Date(), dateLocale, t)}
          </Cell>
        )
      case 'size':
        return (
          <Cell key={col} col={col}>
            {formatBytes(source.sizeBytes, dateLocale)}
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
            <FolderMenu
              label={t('ufActionsFor', { name: source.name })}
              items={[
                ...(canOpen ? [{ id: 'open', label: t('uhSourceOpen'), onSelect: open }] : []),
                { id: 'download', label: t('uhSourceDownload'), onSelect: download },
              ]}
              dataFor={`source:${source.id}`}
              tabbable
              open={menuOpen}
              onOpenChange={onMenuOpenChange}
            />
          </Cell>
        )
      case 'select':
        // a file of another module cannot be selected
        return <Cell key={col} col={col} />
      default:
        // Truy cập and any screen column: nothing to say about a source file
        return (
          <Cell key={col} col={col}>
            <Empty />
          </Cell>
        )
    }
  }

  return (
    <div
      role="row"
      data-source-id={source.id}
      className="dh-doc-row dh-source-row"
      style={{ gridTemplateColumns: trackOf(columns, undefined, false, compact) }}
      onDoubleClick={primary}
    >
      {columns.map(cellFor)}
    </div>
  )
}
