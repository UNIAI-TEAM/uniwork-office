import type { UniworkSourceFile } from '../../../shared/home-api'
import { FileBadge } from '../FileBadge'
import { useI18n } from '../locale'
import { FolderMenu } from '../uniwork-folders/FolderMenu'
import { formatBytes, formatShortDate } from './documents-home-model'

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
 * its editor is the owner, and its primary action is the web's fallback for a
 * file it cannot view in place: Download.
 */
export function DocumentsSourceRow({
  source,
  menuOpen,
  onMenuOpenChange,
  onDownload,
}: {
  source: UniworkSourceFile
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onDownload: (source: UniworkSourceFile) => void
}) {
  const { t, dateLocale } = useI18n()
  const owner = source.owner?.name.trim() ?? ''
  const initial = owner ? (Array.from(owner)[0] ?? '').toUpperCase() : ''
  const download = () => onDownload(source)
  return (
    <div role="row" data-source-id={source.id} className="dh-doc-row dh-source-row">
      <div className="dh-cell-name" role="cell">
        <FileBadge ext={sourceExtension(source)} size={28} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <button type="button" className="dh-doc-open" title={source.name} onClick={download}>
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

      <div className="dh-cell-actions" role="cell" onClick={(e) => e.stopPropagation()}>
        <FolderMenu
          label={t('ufActionsFor', { name: source.name })}
          items={[{ id: 'download', label: t('uhSourceDownload'), onSelect: download }]}
          dataFor={`source:${source.id}`}
          open={menuOpen}
          onOpenChange={onMenuOpenChange}
        />
      </div>
    </div>
  )
}
