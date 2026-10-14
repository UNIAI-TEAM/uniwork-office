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
import { WbRowActions } from './WbRowActions'
import { WorkbenchIcon } from './WorkbenchIcons'
import { WorkStatePanel } from './WorkErrorState'

const APP_EXT: Record<DocumentTabKind, string> = {
  docs: 'docx',
  sheets: 'xlsx',
  slides: 'pptx',
  pdf: 'pdf',
  markdown: 'md',
  html: 'html',
}

/** "Đang làm dở" (office desk spec §3.2): unsaved tabs and recovery copies, then recent documents. */
export function DeskInProgress({
  drafts,
  recent,
  local,
}: {
  drafts: readonly DeskDraft[]
  recent: readonly WorkRecentDocument[]
  /** this device's raw recents (working copies included) */
  local: readonly RecentEntry[]
}): ReactElement {
  const { t, dateLocale } = useI18n()
  const titleId = useId()
  const rows = inProgressRows(drafts, recent, local)
  const when = (ms: number) => formatWhen(new Date(ms).toISOString(), dateLocale)

  return (
    <section className="wb-desk-section" aria-labelledby={titleId}>
      <div className="wb-desk-head">
        <h3 id={titleId}>{t('wbDeskInProgress')}</h3>
      </div>
      {rows.length === 0 ? (
        <WorkStatePanel
          tone="gray"
          icon={<WorkbenchIcon id="desk" size={20} />}
          title={t('wbDeskInProgressEmpty')}
          action={{
            label: t('wbDeskOpenFile'),
            onClick: () => void window.aiOffice.browse(),
            variant: 'secondary',
          }}
          role="status"
        />
      ) : (
        <ul className="wb-ov-list wb-block">
          {rows.map((r) => {
            if (r.kind === 'draft') {
              const d = r.draft
              const go = () => {
                if (d.kind === 'unsaved' && d.tabId) void window.aiOfficeTabs.activate(d.tabId)
                else if (d.filePath) void window.aiOffice.openPath(d.filePath)
              }
              return (
                <li key={`d:${d.tabId ?? d.filePath}`} className="wb-row">
                  <FileBadge ext={APP_EXT[d.app]} size={20} />
                  <button type="button" className="wb-row-title wb-desk-row-title" onClick={go}>
                    {d.title}
                  </button>
                  <span className="wb-pill is-warning">
                    {t(d.kind === 'unsaved' ? 'wbDeskUnsaved' : 'wbDeskRecovery')}
                  </span>
                  {d.modifiedMs ? (
                    <span className="wb-mono wb-num">{when(d.modifiedMs)}</span>
                  ) : null}
                  <WbRowActions>
                    {/* pointer shortcut only: the title button is the keyboard and reader path */}
                    <button
                      type="button"
                      className="wb-btn wb-btn-ghost wb-btn-sm"
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={go}
                    >
                      {t(d.kind === 'unsaved' ? 'wbDeskSwitchTo' : 'wbCommonOpen')}
                    </button>
                  </WbRowActions>
                </li>
              )
            }
            const doc = r.doc
            if (doc.source === 'uniwork') {
              return (
                <li key={`u:${doc.doc.id}`} className="wb-row">
                  <FileBadge ext={docExtension(doc.doc)} size={20} />
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
                  <span className="wb-mono wb-num">
                    {formatWhen(doc.doc.updatedAt, dateLocale)}
                  </span>
                </li>
              )
            }
            const e = doc.entry
            return (
              <li key={`l:${e.path}`} className="wb-row">
                <FileBadge ext={e.ext} size={20} />
                <button
                  type="button"
                  className="wb-row-title wb-desk-row-title"
                  onClick={() => void openRecentEntry(e, window.aiOffice)}
                >
                  {e.name}
                </button>
                <span className="wb-mono wb-num">
                  {when(e.mtimeMs)} · {t('wbOnThisDevice')}
                </span>
                <WbRowActions>
                  <button
                    type="button"
                    className="wb-btn wb-btn-ghost wb-btn-sm"
                    onClick={() => void window.aiOffice.revealPath(e.path)}
                  >
                    {t('wbDeskShowInFolder')}
                  </button>
                </WbRowActions>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
