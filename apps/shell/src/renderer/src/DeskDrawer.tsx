import { useId, useState } from 'react'
import type { ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import { FileBadge } from './FileBadge'
import { draftFromForm } from './form-draft'
import { useI18n } from './locale'
import { readForms, writeForms, type WbFormItem } from './workbench-pins'
import { WbGlyph, WorkbenchIcon } from './WorkbenchIcons'

const DRAWER_FORMS = 8

/** "Ngăn kéo" (office desk spec §3.3): the saved forms, one click to draft. */
export function DeskDrawer({
  practiceId,
  packId,
  orgId,
  vi,
  onManage,
  onPackLinked,
}: {
  practiceId: PracticeId
  /** where a draft goes (selected pack, else the default one); null = none yet */
  packId: string | null
  orgId: string | null
  vi: boolean
  onManage: () => void
  /** a draft linked a form to the pack: the page refreshes its packs (as the Forms tab's Draft does) */
  onPackLinked?: () => void
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  // the Desk remounts each time its tab is shown, so a read on mount sees Forms' edits
  const [forms] = useState(() => readForms(practiceId).slice(0, DRAWER_FORMS))

  // the Forms tab's Draft action (WorkbenchModulePanes openForm): draft, link the form, refresh
  const draft = async (item: WbFormItem, pack: string) => {
    await draftFromForm(item, pack, orgId, vi)
    if (item.linkedProjectId !== pack)
      writeForms(
        practiceId,
        readForms(practiceId).map((x) => (x.id === item.id ? { ...x, linkedProjectId: pack } : x)),
      )
    onPackLinked?.()
  }

  return (
    <section className="wb-desk-section" aria-labelledby={titleId}>
      <div className="wb-desk-head">
        <h3 id={titleId}>{t('wbDeskDrawer')}</h3>
        <button type="button" className="wb-link" onClick={onManage}>
          {t('wbDeskDrawerManage')}
          <WbGlyph id="arrowRight" size={14} />
        </button>
      </div>
      {forms.length === 0 ? (
        <p className="wb-ov-note">
          {t('wbDeskDrawerEmpty')} ·{' '}
          <button type="button" className="wb-link" onClick={onManage}>
            {t('wbDeskDrawerAdd')}
          </button>
        </p>
      ) : (
        <>
          {/* visible, not only a tooltip: a disabled chip's title never reaches keyboard users */}
          {packId ? null : (
            <span className="wb-forms-locked">{t('wbFormsDraftNeedsPackHint')}</span>
          )}
          <ul className="wb-desk-chips">
            {forms.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="wb-btn wb-btn-secondary wb-btn-sm wb-desk-chip"
                  disabled={!packId}
                  title={packId ? (f.note ?? f.title) : t('wbFormsDraftNeedsPack')}
                  onClick={() => {
                    if (packId) void draft(f, packId)
                  }}
                >
                  {f.fileExt ? (
                    <FileBadge ext={f.fileExt.replace(/^\./, '')} size={16} />
                  ) : (
                    <WorkbenchIcon id="forms" size={16} />
                  )}
                  {f.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
