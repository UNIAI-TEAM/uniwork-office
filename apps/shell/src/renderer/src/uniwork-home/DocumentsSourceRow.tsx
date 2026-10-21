import type { UniworkSourceFile } from '../../../shared/home-api'
import { FileBadge } from '../FileBadge'
import { useI18n } from '../locale'
import { FolderMenu } from '../uniwork-folders/FolderMenu'
import { formatBytes, formatShortDate } from './documents-home-model'
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
  menuOpen,
  onMenuOpenChange,
  onOpen,
  onDownload,
}: {
  source: UniworkSourceFile
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onOpen: (source: UniworkSourceFile) => void
  onDownload: (source: UniworkSourceFile) => void
}) {
  const { t, dateLocale } = useI18n()
  const owner = source.owner?.name.trim() ?? ''
  const initial = owner ? (Array.from(owner)[0] ?? '').toUpperCase() : ''
  const download = () => onDownload(source)
  const canOpen = openable(source)
  const open = () => onOpen(source)
  const primary = canOpen ? open : download
  return (
    <div
      role="row"
      data-source-id={source.id}
      className="dh-doc-row dh-source-row"
      onDoubleClick={primary}
    >
      <div className="dh-cell-name" role="cell">
        <FileBadge ext={sourceExtension(source)} size={28} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <button type="button" className="dh-doc-open" title={source.name} onClick={primary}>
            {source.name}
          </button>
        </div>
      </div>

      <div className="dh-cell-access" role="cell">
        <span className="dh-cell-empty">—</span>
      </div>

      <div className="dh-cell-person" role="cell">
        {owner ? (
          <>
            <span className="dh-avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="dh-person-name" title={owner}>
              {owner}
            </span>
          </>
        ) : (
          <span className="dh-cell-empty">—</span>
        )}
      </div>

      <div className="dh-cell-time" role="cell">
        {formatShortDate(source.updatedAt, dateLocale)}
      </div>

      <div className="dh-cell-size" role="cell">
        {formatBytes(source.sizeBytes, dateLocale)}
      </div>

      <div
        className="dh-cell-actions"
        role="cell"
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
          open={menuOpen}
          onOpenChange={onMenuOpenChange}
        />
      </div>
    </div>
  )
}
