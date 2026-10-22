import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { useI18n, type StringKey } from '../locale'
import type { AskUniEffort, AskUniModel } from '../../../shared/askuni-api'
import type { AskUniModelSelection } from './model-choice'
import { usePopoverDismiss } from './frame-popover'

const MODEL_KEYS: Record<string, { name: StringKey; desc: StringKey }> = {
  haiku: { name: 'askUniV2ModelHaiku', desc: 'askUniV2ModelHaikuDesc' },
  sonnet: { name: 'askUniV2ModelSonnet', desc: 'askUniV2ModelSonnetDesc' },
  opus: { name: 'askUniV2ModelOpus', desc: 'askUniV2ModelOpusDesc' },
}
const EFFORTS: readonly (AskUniEffort | '')[] = ['', 'low', 'medium', 'high']
const EFFORT_KEYS: Record<AskUniEffort | '', StringKey> = {
  '': 'askUniV2EffortAuto',
  low: 'askUniV2EffortLow',
  medium: 'askUniV2EffortMedium',
  high: 'askUniV2EffortHigh',
}
const STEPS = [1, 2, 3, 4, 5]

function Bar({ label, value }: { label: string; value: number }): ReactElement {
  const { t } = useI18n()
  const filled = Math.max(0, Math.min(5, Math.round(value)))
  return (
    <span className="askuni2-bar-row">
      <span>{label}</span>
      <span
        className="askuni2-bar"
        role="img"
        aria-label={t('askUniV2ModelBar', { label, value: String(filled) })}
      >
        {STEPS.map((s) => (
          <span key={s} aria-hidden="true" className={s <= filled ? 'is-on' : undefined} />
        ))}
      </span>
    </span>
  )
}

function Chevron(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

/** Model + effort choice (web P2): Auto and the models the organization enabled, with speed/intelligence/cost hints. */
export function AskUniModelPicker({
  selection,
  disabled = false,
}: {
  selection: AskUniModelSelection
  disabled?: boolean
}): ReactElement {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  usePopoverDismiss(open, () => setOpen(false), anchorRef, popRef)

  const { enabled, model, effort, autoModel } = selection
  const nameOf = (key: string): string => {
    const k = MODEL_KEYS[key]
    return k ? t(k.name) : key
  }
  const chosen = model ? nameOf(model) : t('askUniV2ModelAuto')
  const current = effort ? `${chosen} · ${t(EFFORT_KEYS[effort])}` : chosen

  const focusAt = (items: HTMLElement[], i: number) =>
    items[(i + items.length) % items.length]?.focus()
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      popRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
    )
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusAt(items, at + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusAt(items, at < 0 ? -1 : at - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusAt(items, 0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusAt(items, -1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const pickModel = (m: AskUniModel) => {
    selection.setModel(m)
    setOpen(false)
  }

  // focus the first item as the menu opens
  const focusFirst = (el: HTMLDivElement | null) => {
    popRef.current = el
    if (el && !el.contains(document.activeElement)) {
      el.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
    }
  }

  return (
    <span className="askuni2-picker">
      <button
        ref={anchorRef}
        type="button"
        className="askuni2-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('askUniV2ModelLabelWith', { model: current })}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="askuni2-pill-text">{current}</span>
        <Chevron />
      </button>
      {open ? (
        <div
          ref={focusFirst}
          id={menuId}
          role="menu"
          aria-label={t('askUniV2ModelMenu')}
          className="askuni2-popover askuni2-model-menu"
          onKeyDown={onKeyDown}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={model === ''}
            tabIndex={-1}
            className="askuni2-radio"
            onClick={() => pickModel('')}
          >
            <span className="askuni2-radio-main">
              {autoModel
                ? t('askUniV2ModelAutoCurrent', { model: nameOf(autoModel) })
                : t('askUniV2ModelAuto')}
            </span>
          </button>
          {enabled.map((m) => (
            <button
              key={m.key}
              type="button"
              role="menuitemradio"
              aria-checked={model === m.key}
              tabIndex={-1}
              className="askuni2-radio"
              onClick={() => pickModel(m.key)}
            >
              <span className="askuni2-radio-main">{nameOf(m.key)}</span>
              {MODEL_KEYS[m.key] ? (
                <span className="askuni2-radio-desc">{t(MODEL_KEYS[m.key]!.desc)}</span>
              ) : null}
              <Bar label={t('askUniV2ModelSpeed')} value={m.speed} />
              <Bar label={t('askUniV2ModelIntelligence')} value={m.intelligence} />
              <Bar label={t('askUniV2ModelCost')} value={m.cost} />
            </button>
          ))}
          <p className="askuni2-menu-caption">{t('askUniV2ModelEffort')}</p>
          {EFFORTS.map((e) => (
            <button
              key={e || 'auto'}
              type="button"
              role="menuitemradio"
              aria-checked={effort === e}
              tabIndex={-1}
              className="askuni2-radio"
              onClick={() => selection.setEffort(e)}
            >
              <span className="askuni2-radio-main">{t(EFFORT_KEYS[e])}</span>
            </button>
          ))}
        </div>
      ) : null}
      {model === 'opus' ? (
        <p role="status" className="askuni2-note">
          {t('askUniV2ModelOpusNote')}
        </p>
      ) : null}
    </span>
  )
}
