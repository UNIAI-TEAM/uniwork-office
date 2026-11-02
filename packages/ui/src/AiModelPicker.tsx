import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { uniworkAiAvailable, type AiSettings } from '@genoffice/ai-provider/browser'
import { setAiModelNeedHint } from './ai-model-need'
import { ProviderLogo } from './provider-logos'
import { useDismissablePopover } from './popover-dismiss'
import { AI_MODEL_PICKER_STRINGS } from './strings-ai-model-picker'
import { aiUniworkStrings, aiUniworkText } from './strings-ai-uniwork'

export type AiModelPickerCloudState =
  | 'ready'
  | 'not-entitled'
  | 'subscription-inactive'
  | 'credits-exhausted'
  | 'unavailable'
  | 'signed-out'

export interface AiModelPickerCloudCredits {
  readonly remaining: number | null
  readonly limit: number | null
  readonly periodEnd?: string | null | undefined
  readonly periodEndsAt?: string | null | undefined
}

export interface AiModelPickerCloudStatus {
  readonly state: AiModelPickerCloudState
  readonly signedIn?: boolean | undefined
  readonly enabled?: boolean | undefined
  readonly hasCompletedRead?: boolean | undefined
  readonly cloudUnavailable?: boolean | undefined
  readonly reason?: string | null | undefined
  readonly credits?: AiModelPickerCloudCredits | null | undefined
}

/** Each app's preload exposes these under its own namespace; the panel adapts them. */
export interface AiModelPickerBridge {
  /** the AI settings; the chip reads the model UniWork AI serves (`uniworkModel`) */
  readonly getSettings: () => Promise<AiSettings>
  /** fires after any renderer (this one, another tab, the shell) saved ai-settings.json */
  readonly onSettingsChanged?: ((handler: () => void) => () => void) | undefined
  /** shell: switch to Home and open Settings › Account (the footer's "Details"); absent on a web frame */
  readonly openModelSettings?: (() => Promise<void> | void) | undefined
  /** shell: switch to Home and open Settings › Account */
  readonly openAccountSettings?: (() => Promise<void> | void) | undefined
  /** shell: trigger or open UniWork sign-in */
  readonly signIn?: (() => Promise<void> | void) | undefined
  /** read current UniWork cloud status (falls back to window.uniworkCloudStatus.get) */
  readonly getCloudStatus?:
    (() => Promise<AiModelPickerCloudStatus | null> | AiModelPickerCloudStatus | null) | undefined
  /** alias for getCloudStatus */
  readonly cloudStatus?:
    | (() => Promise<AiModelPickerCloudStatus | null> | AiModelPickerCloudStatus | null)
    | AiModelPickerCloudStatus
    | null
    | undefined
  /** subscribe to UniWork cloud status updates (falls back to window.uniworkCloudStatus.onChange) */
  readonly onCloudStatusChanged?:
    ((handler: (status: AiModelPickerCloudStatus | null) => void) => () => void) | undefined
}

interface WindowCloudStatusBridge {
  readonly get?: () => Promise<AiModelPickerCloudStatus | null> | AiModelPickerCloudStatus | null
  readonly onChange?: (cb: (status: AiModelPickerCloudStatus | null) => void) => () => void
  readonly onChanged?: (cb: (status: AiModelPickerCloudStatus | null) => void) => () => void
  readonly openAccountSettings?: () => Promise<void> | void
  readonly signIn?: () => Promise<void> | void
}

function getWindowCloudStatusBridge(): WindowCloudStatusBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { uniworkCloudStatus?: WindowCloudStatusBridge }).uniworkCloudStatus
}

type CloudStringKey =
  | 'cloudStateNotEntitled'
  | 'cloudStateInactive'
  | 'cloudStateExhausted'
  | 'cloudStateUnavailable'
  | 'cloudCreditsLeft'
  | 'cloudCreditsUnlimited'
  | 'acctSignIn'

function pickerCloudText(
  lang: Lang,
  key: CloudStringKey,
  params?: Record<string, string | number>,
): string {
  const template = (aiUniworkStrings[lang] ?? aiUniworkStrings.en)[key]
  if (!params) return template
  return template.replace(/\{([a-zA-Z0-9]+)\}/g, (match, token: string) =>
    token in params ? String(params[token]) : match,
  )
}

/** credits grouped by the UI language (vi 380.000, en 380,000); a runtime without that locale prints plain digits */
function formatCreditCount(lang: Lang, value: number): string {
  try {
    return new Intl.NumberFormat(lang).format(value)
  } catch {
    return String(value)
  }
}

function restoreChipFocusUnlessMoved(
  chip: HTMLButtonElement | null,
  pop: HTMLDivElement | null,
): void {
  if (!chip || typeof document === 'undefined') return
  const active = document.activeElement
  const stayedInPicker =
    !active ||
    active === document.body ||
    active === document.documentElement ||
    chip.contains(active) ||
    Boolean(pop?.contains(active))
  if (stayedInPicker) {
    chip.focus()
  }
}

/**
 * Composer footer chip naming UniWork AI (or the model it serves). AI runs on UniWork AI only, so
 * there is nothing to choose: the popover shows the organization's credits and, when UniWork AI
 * cannot answer, the cloud state with its one way out (sign in, or the account settings).
 */
export function AiModelPicker({
  bridge,
  lang,
}: {
  readonly bridge: AiModelPickerBridge
  readonly lang: Lang
}): React.JSX.Element | null {
  const strings = AI_MODEL_PICKER_STRINGS[lang] ?? AI_MODEL_PICKER_STRINGS.en
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [cloudStatus, setCloudStatus] = useState<AiModelPickerCloudStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const bridgeRef = useRef(bridge)
  bridgeRef.current = bridge

  const baseId = useId()
  const popId = `${baseId}-pop`

  // mount, window focus and settings changes re-read the settings (the served model) and the cloud
  // status; opening the popover does not (the status has its own change feed). Tests render panels
  // without a preload bridge: a throwing getter must not take the panel down
  const refresh = useCallback(() => {
    const b = bridgeRef.current
    Promise.resolve()
      .then(() => b.getSettings())
      .then(setSettings, () => {})
    const winCloud = getWindowCloudStatusBridge()
    const rawCloud = b.getCloudStatus ?? b.cloudStatus ?? winCloud?.get
    if (typeof rawCloud === 'function') {
      Promise.resolve()
        .then(() => rawCloud())
        .then(
          (next) => setCloudStatus(next ?? null),
          () => {},
        )
    } else if (rawCloud !== undefined) {
      setCloudStatus(rawCloud)
    }
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    const b = bridgeRef.current
    let offSettings: (() => void) | undefined
    try {
      offSettings = b.onSettingsChanged?.(refresh)
    } catch {
      offSettings = undefined
    }
    let offCloud: (() => void) | undefined
    const winCloud = getWindowCloudStatusBridge()
    const sub = b.onCloudStatusChanged ?? winCloud?.onChange ?? winCloud?.onChanged
    try {
      offCloud = sub?.((next) => setCloudStatus(next ?? null))
    } catch {
      offCloud = undefined
    }
    return () => {
      window.removeEventListener('focus', refresh)
      offSettings?.()
      offCloud?.()
    }
  }, [refresh])

  const close = useCallback(() => setOpen(false), [])
  useDismissablePopover(open, close, {
    inside: () => [chipRef.current, popRef.current],
  })

  // UniWork AI cannot answer while the host does not offer it (signed out, no organization, the
  // capability off) or the cloud reports a state other than ready: the composer's send stays off
  // and the hint says so, with the account settings as the way out
  const offeredByCloud =
    cloudStatus === null ||
    cloudStatus.hasCompletedRead === false ||
    (cloudStatus.state === 'ready' && cloudStatus.enabled !== false)
  const needHint = settings !== null && !(uniworkAiAvailable() && offeredByCloud) ? strings.needModel : null
  const openSettings = bridge.openModelSettings
  const openSettingsOnce = useCallback(() => {
    void openSettings?.()
  }, [openSettings])
  useEffect(() => {
    setAiModelNeedHint(needHint, openSettings ? openSettingsOnce : null)
    return () => setAiModelNeedHint(null)
  }, [needHint, openSettings, openSettingsOnce])

  const toggle = () => {
    if (!open) {
      const rect = chipRef.current?.getBoundingClientRect()
      const zoom = effectiveZoom(chipRef.current)
      // the composer sits at the panel bottom: open upwards, pinned to the chip;
      // divide window-px offsets and the 70vh cap by any ancestor CSS zoom (.copilot, .app-frame)
      if (rect) {
        setPopStyle({
          left: rect.left / zoom,
          bottom: (window.innerHeight - rect.top + 6) / zoom,
          maxHeight: Math.min(420, (window.innerHeight * 0.7) / zoom),
        })
      }
    }
    setOpen((v) => !v)
  }

  const credits = cloudStatus?.credits ?? null
  const creditsVisibleText = credits
    ? credits.limit === null
      ? pickerCloudText(lang, 'cloudCreditsUnlimited')
      : credits.remaining !== null
        ? pickerCloudText(lang, 'cloudCreditsLeft', {
            remaining: formatCreditCount(lang, credits.remaining),
            limit: formatCreditCount(lang, credits.limit),
          })
        : null
    : null
  const creditsAriaText = credits
    ? credits.limit === null
      ? pickerCloudText(lang, 'cloudCreditsUnlimited')
      : credits.remaining !== null
        ? aiUniworkText(lang, 'aiUniworkCreditsAria', {
            remaining: formatCreditCount(lang, credits.remaining),
            limit: formatCreditCount(lang, credits.limit),
          })
        : null
    : null

  const footerInfo = useMemo(() => {
    if (!cloudStatus || cloudStatus.hasCompletedRead === false) return null
    switch (cloudStatus.state) {
      case 'signed-out':
        return {
          text: aiUniworkText(lang, 'aiUniworkFooterSignIn'),
          actionLabel: pickerCloudText(lang, 'acctSignIn'),
          kind: 'sign-in' as const,
        }
      case 'not-entitled':
        return {
          text: pickerCloudText(lang, 'cloudStateNotEntitled'),
          actionLabel: aiUniworkText(lang, 'aiUniworkDetails'),
          kind: 'details' as const,
        }
      case 'subscription-inactive':
        return {
          text: pickerCloudText(lang, 'cloudStateInactive'),
          actionLabel: aiUniworkText(lang, 'aiUniworkDetails'),
          kind: 'details' as const,
        }
      case 'credits-exhausted':
        return {
          text: pickerCloudText(lang, 'cloudStateExhausted'),
          actionLabel: aiUniworkText(lang, 'aiUniworkDetails'),
          kind: 'details' as const,
        }
      case 'unavailable':
        if (cloudStatus.cloudUnavailable === true || cloudStatus.reason === 'cloud_unavailable') {
          return {
            text: pickerCloudText(lang, 'cloudStateUnavailable'),
            actionLabel: aiUniworkText(lang, 'aiUniworkDetails'),
            kind: 'details' as const,
          }
        }
        return null
      case 'ready':
      default:
        return null
    }
  }, [cloudStatus, lang])

  const onFooterAction = () => {
    const pop = popRef.current
    setOpen(false)
    const winCloud = getWindowCloudStatusBridge()
    if (footerInfo?.kind === 'sign-in') {
      void (
        bridge.signIn ??
        winCloud?.signIn ??
        bridge.openAccountSettings ??
        winCloud?.openAccountSettings ??
        bridge.openModelSettings
      )?.()
    } else {
      void (
        bridge.openAccountSettings ??
        winCloud?.openAccountSettings ??
        bridge.openModelSettings
      )?.()
    }
    restoreChipFocusUnlessMoved(chipRef.current, pop)
  }

  if (!settings) return null
  const chipText = settings.uniworkModel?.trim() || UNIWORK_LABEL
  const chipLabel = `${strings.title}: ${chipText}`

  return (
    <div
      className="ai-model-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
          chipRef.current?.focus()
        }
      }}
    >
      <button
        ref={chipRef}
        type="button"
        className={`ai-model-chip${open ? ' open' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        title={chipLabel}
        data-tip={chipLabel}
        aria-label={chipLabel}
      >
        <ProviderLogo />
        <span className="ai-model-chip-text">{chipText}</span>
        <svg className="ai-model-chip-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M2 6.5 5 3.5l3 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          ref={popRef}
          id={popId}
          className="ai-model-pop"
          role="group"
          aria-label={strings.title}
          style={popStyle}
        >
          <div className="ai-model-current">
            <ProviderLogo />
            <span className="ai-model-item-body">
              <span className="ai-model-item-text">{chipText}</span>
              {creditsVisibleText && (
                // the "/" line is for the eye; the spoken sentence sits beside it
                <span className="ai-model-item-sub" aria-hidden="true">
                  {creditsVisibleText}
                </span>
              )}
            </span>
          </div>
          {creditsAriaText && <span className="ai-model-sr-only">{creditsAriaText}</span>}
          {footerInfo && (
            <div className="ai-model-footer">
              <span className="ai-model-footer-text">{footerInfo.text}</span>
              <button type="button" className="ai-model-footer-action" onClick={onFooterAction}>
                {footerInfo.actionLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** the product name; the chip shows the served model instead once the host knows it */
const UNIWORK_LABEL = 'UniWork AI'

function effectiveZoom(el: HTMLElement | null): number {
  if (!el) return 1
  let zoom = 1
  for (let cur: HTMLElement | null = el; cur; cur = cur.parentElement) {
    const raw = window.getComputedStyle?.(cur)?.zoom
    if (raw) {
      const n = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw)
      if (Number.isFinite(n) && n > 0) zoom *= n
    }
  }
  if (zoom !== 1) return zoom
  const cssZoom = (el as HTMLElement & { currentCSSZoom?: unknown }).currentCSSZoom
  if (typeof cssZoom === 'number' && Number.isFinite(cssZoom) && cssZoom > 0) {
    return cssZoom
  }
  return 1
}
