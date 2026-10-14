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
  packs = [],
  selectedPackId = null,
  onSelectPack,
}: {
  practiceId: PracticeId
  /** where a draft goes (selected pack, else the default one); null = none yet */
  packId: string | null
  /** the packs the chip offers; "Default project" stands for no selection */
  packs?: readonly { id: string; title: string }[]
  /** the pack picked in Knowledge; null = the default one */
  selectedPackId?: string | null
  onSelectPack?: (id: string | null) => void
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

  const add = (
    <button type="button" className="wb-btn wb-btn-ghost" onClick={onManage}>
      <WbGlyph id="plus" />
      {t('wbDeskDrawerAdd')}
    </button>
  )

  return (
    <section className="wb-desk-section" aria-labelledby={titleId}>
      <div className="wb-desk-drawer-head">
        <h3 id={titleId}>{t('wbDeskDrawer')}</h3>
        <span className="wb-desk-head-note">{t('wbDeskDrawerInto')}</span>
        <WbPackChip packs={packs} selectedPackId={selectedPackId} onSelectPack={onSelectPack} />
        <button type="button" className="wb-link wb-desk-head-end" onClick={onManage}>
          {t('wbDeskDrawerManage')}
        </button>
      </div>
      {forms.length === 0 ? (
        <div className="wb-desk-chips">
          <p className="wb-ov-note">{t('wbDeskDrawerEmpty')}</p>
          {add}
        </div>
      ) : (
        <>
          {/* visible, not only a tooltip: a disabled chip's title never reaches keyboard users */}
          {packId ? null : <p className="wb-forms-locked">{t('wbFormsDraftNeedsPackHint')}</p>}
          <ul className="wb-desk-chips">
            {forms.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="wb-btn wb-btn-secondary wb-desk-chip"
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
            <li>{add}</li>
          </ul>
        </>
      )}
    </section>
  )
}

/**
 * The chip that picks a pack (spec 4.1, 4.4, 4.8, 4.9): a transparent select over the chip, like
 * the workspace chip. The empty choice stands for no selection: "Default project" where drafts
 * from forms go, else `noneLabel`. `format` wraps the shown name ("Pack: …", "Context: …").
 */
export function WbPackChip({
  packs,
  selectedPackId,
  onSelectPack,
  noneLabel,
  format,
  ariaLabel,
  className = 'wb-desk-pack',
}: {
  packs: readonly { id: string; title: string }[]
  selectedPackId: string | null
  onSelectPack?: (id: string | null) => void
  noneLabel?: string
  format?: (name: string) => string
  ariaLabel?: string
  /** the 24px card-head size by default; a toolbar passes its own class for the 28px chip */
  className?: string
}): ReactElement {
  const { t } = useI18n()
  const none = noneLabel ?? t('wbDeskDefaultPack')
  const name = (selectedPackId && packs.find((p) => p.id === selectedPackId)?.title) || none
  const packLabel = format ? format(name) : name
  return (
    <span className={className ? `wb-crumb ${className}` : 'wb-crumb'}>
      <span className="wb-crumb-name" aria-hidden="true">
        {packLabel}
      </span>
      <span className="wb-crumb-caret" aria-hidden="true">
        <WbGlyph id="chevronDown" size={12} />
      </span>
      <select
        aria-label={ariaLabel ?? t('wbDeskDrawerPack')}
        value={selectedPackId ?? ''}
        onChange={(e) => onSelectPack?.(e.target.value || null)}
      >
        <option value="">{none}</option>
        {packs.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
    </span>
  )
}
