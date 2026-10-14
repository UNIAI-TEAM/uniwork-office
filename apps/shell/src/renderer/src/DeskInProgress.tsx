import { useId } from 'react'
import type { ReactElement } from 'react'
import type { DeskDraft, RecentEntry } from '../../shared/home-api'
import type { DocumentTabKind } from '../../shared/tabs-api'
import type { WorkRecentDocument } from '../../shared/uniwork-work-api'
import { inProgressRows } from './desk-model'
import { FileBadge } from './FileBadge'
import { useI18n } from './locale'
import { docExtension, formatWhen } from './uniwork-docs-model'
import { openRecentEntry, openUniworkDocument } from './uniwork-open'
import { WbIconBtn, WbRowActions } from './WbRowActions'
import { WbGlyph, WorkbenchIcon } from './WorkbenchIcons'
import { WorkSkeleton, WorkStatePanel } from './WorkErrorState'

const APP_EXT: Record<DocumentTabKind, string> = {
  docs: 'docx',
  sheets: 'xlsx',
  slides: 'pptx',
  pdf: 'pdf',
  markdown: 'md',
  html: 'html',
}

/** the folder a file sits in, by name ("/w/Họp/a.docx" -> "Họp") */
const folderName = (path: string) => path.split(/[\\/]/).slice(-2, -1)[0] ?? ''

/** "Đang làm dở" (office desk spec §3.2): unsaved tabs and recovery copies, then recent documents. */
export function DeskInProgress({
  drafts,
  recent,
  local,
  loading = false,
}: {
  drafts: readonly DeskDraft[]
  recent: readonly WorkRecentDocument[]
  /** this device's raw recents (working copies included) */
  local: readonly RecentEntry[]
  /** drafts or recents have not answered yet: a skeleton, not the empty line */
  loading?: boolean
}): ReactElement {
  const { t, dateLocale } = useI18n()
  const titleId = useId()
  const rows = inProgressRows(drafts, recent, local)
  const when = (ms: number) => formatWhen(new Date(ms).toISOString(), dateLocale)

  const body = () => {
    if (loading) return <WorkSkeleton rows={3} />
    if (rows.length === 0)
      return (
        <WorkStatePanel
          tone="gray"
          icon={<WorkbenchIcon id="desk" size={20} />}
          title={t('wbDeskInProgressEmpty')}
          role="status"
          compact
        />
      )
    return (
      <ul className="wb-ov-list">
        {rows.map((r) => {
          if (r.kind === 'draft') {
            const d = r.draft
            const unsaved = d.kind === 'unsaved'
            const go = () => {
              if (unsaved && d.tabId) void window.aiOfficeTabs.activate(d.tabId)
              else if (d.filePath) void window.aiOffice.openPath(d.filePath)
            }
            return (
              <li key={`d:${d.tabId ?? d.filePath}`} className="wb-row wb-desk-row">
                <FileBadge ext={APP_EXT[d.app]} size={24} />
                <span className="wb-desk-row-main">
                  <button type="button" className="wb-row-title wb-desk-row-title" onClick={go}>
                    {d.title}
                  </button>
                  <span className="wb-desk-reason">
                    {t(unsaved ? 'wbDeskSubOpenTab' : 'wbDeskSubRecovery')}
                  </span>
                </span>
                <span className={`wb-pill ${unsaved ? 'is-warning' : 'is-info'}`}>
                  {t(unsaved ? 'wbDeskUnsaved' : 'wbDeskRecovery')}
                </span>
                <button
                  type="button"
                  className="wb-btn wb-btn-secondary wb-btn-sm wb-desk-row-act"
                  onClick={go}
                >
                  {t(unsaved ? 'wbDeskSwitchTo' : 'wbDeskRestore')}
                </button>
              </li>
            )
          }
          const doc = r.doc
          if (doc.source === 'uniwork') {
            return (
              <li key={`u:${doc.doc.id}`} className="wb-row wb-desk-row">
                <FileBadge ext={docExtension(doc.doc)} size={24} />
                <span className="wb-desk-row-main">
                  <button
                    type="button"
                    className="wb-row-title wb-desk-row-title"
                    onClick={() =>
                      void openUniworkDocument(
                        { documentId: doc.doc.id, title: doc.doc.title },
                        window.aiOffice,
                      )
                    }
                  >
                    {doc.doc.title}
                  </button>
                  <span className="wb-desk-reason">
                    {[t('wbDeskSubCloud'), doc.doc.updatedByName].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="wb-desk-when wb-num">
                  {formatWhen(doc.doc.updatedAt, dateLocale)}
                </span>
              </li>
            )
          }
          const e = doc.entry
          return (
            <li key={`l:${e.path}`} className="wb-row wb-desk-row">
              <FileBadge ext={e.ext} size={24} />
              <span className="wb-desk-row-main">
                <button
                  type="button"
                  className="wb-row-title wb-desk-row-title"
                  onClick={() => void openRecentEntry(e, window.aiOffice)}
                >
                  {e.name}
                </button>
                <span className="wb-desk-reason">
                  {[t('wbOnThisDevice'), folderName(e.path)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="wb-desk-when wb-num">{when(e.mtimeMs)}</span>
              <WbRowActions>
                <WbIconBtn
                  label={t('wbDeskShowInFolder')}
                  onClick={() => void window.aiOffice.revealPath(e.path)}
                >
                  <WbGlyph id="folder" />
                </WbIconBtn>
              </WbRowActions>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <section className="wb-desk-card wb-block" aria-labelledby={titleId}>
      <div className="wb-desk-head">
        <h3 id={titleId}>{t('wbDeskInProgress')}</h3>
        {!loading && rows.length > 0 ? (
          <span className="wb-desk-count wb-num">{rows.length}</span>
        ) : null}
        <button
          type="button"
          className="wb-link wb-desk-head-end"
          onClick={() => void window.aiOffice.browse()}
        >
          {t('wbDeskOpenFile')}
        </button>
      </div>
      {body()}
    </section>
  )
}
