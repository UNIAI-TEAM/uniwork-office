import { useState, type ReactNode } from 'react'
import { useI18n } from '../locale'
import { FolderMenu } from './FolderMenu'
import { breadcrumbOf, type PathPart } from './uniwork-folders-model'

/**
 * FD-11 S1 breadcrumb above the contents: root > … > leaf. Past 4 levels it
 * shows root, "…", parent, leaf; "…" opens a menu of the hidden levels. The
 * leaf is the current page (not a button). With `leafActions` the leaf is the
 * page's bold h1 and those controls (rename, the folder menu) follow it inside
 * the same crumb: the open folder's one header row (UNI-1979). Ancestors
 * truncate first, the leaf last (CSS).
 */
export function BrowserCrumbs({
  path,
  onOpen,
  leafActions,
}: {
  path: PathPart[]
  onOpen: (folderId: string | null) => void
  leafActions?: ReactNode
}) {
  const { t } = useI18n()
  const [moreOpen, setMoreOpen] = useState(false)
  const crumbs = breadcrumbOf(path, t('ufRoot'))
  return (
    <nav className="uwf-crumbs" aria-label={t('ufBreadcrumb')}>
      <ol>
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1
          if (crumb.kind === 'more') {
            return (
              <li key="more" className="uwf-crumb uwf-crumb-root">
                <FolderMenu
                  label={t('ufMoreLevels')}
                  dataFor="crumbs-more"
                  tabbable
                  open={moreOpen}
                  onOpenChange={setMoreOpen}
                  items={crumb.hidden.map((p) => ({
                    id: p.id,
                    label: p.title,
                    onSelect: () => onOpen(p.id),
                  }))}
                />
                <span className="uwf-crumb-sep" aria-hidden="true">
                  ›
                </span>
              </li>
            )
          }
          return (
            <li
              key={crumb.id ?? 'root'}
              className={`uwf-crumb ${last ? 'uwf-crumb-leaf' : i === 0 ? 'uwf-crumb-root' : 'uwf-crumb-ancestor'}`}
            >
              {last && leafActions !== undefined ? (
                <>
                  <h1
                    className="uwf-crumb-current uwf-crumb-heading"
                    aria-current="page"
                    title={crumb.title}
                  >
                    {crumb.title}
                  </h1>
                  <span className="uwf-crumb-actions">{leafActions}</span>
                </>
              ) : last ? (
                <span className="uwf-crumb-current" aria-current="page">
                  {crumb.title}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="uwf-crumb-btn"
                    data-crumb={crumb.id ?? ''}
                    onClick={() => onOpen(crumb.id)}
                  >
                    {crumb.title}
                  </button>
                  <span className="uwf-crumb-sep" aria-hidden="true">
                    ›
                  </span>
                </>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
