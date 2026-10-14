import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { AiSettings } from '@genoffice/ai-provider/browser'
import {
  aiModelPickerGroups,
  aiModelPickerNeed,
  aiModelPickerSelection,
  withAiModelSelection,
  type AiModelPickerSelection,
} from './ai-model-picker-options'
import { setAiModelNeedHint } from './ai-model-need'
import { ProviderLogo } from './provider-logos'
import { useDismissablePopover } from './popover-dismiss'
import { AI_MODEL_PICKER_STRINGS, type AiModelPickerStrings } from './strings-ai-model-picker'
import { aiUniworkStrings, aiUniworkText } from './strings-ai-uniwork'

export type AiModelPickerCloudState =
  | 'ready'
  | 'not-entitled'
  | 'subscription-inactive'
  | 'credits-exhausted'
  | 'unavailable'
  | 'signed-out'

export interface AiModelPickerCloudCredits {
  readonly remaining: number
  readonly limit: number | null
  readonly periodEndsAt?: string | null | undefined
}

export interface AiModelPickerCloudStatus {
  readonly state: AiModelPickerCloudState
  readonly signedIn?: boolean | undefined
  readonly hasCompletedRead?: boolean | undefined
  readonly cloudUnavailable?: boolean | undefined
  readonly reason?: string | null | undefined
  readonly credits?: AiModelPickerCloudCredits | null | undefined
}

/** Each app's preload exposes these under its own namespace; the panel adapts them. */
export interface AiModelPickerBridge {
  readonly getSettings: () => Promise<AiSettings>
  readonly setSettings: (settings: AiSettings) => Promise<void>
  /** fires after any renderer (this one, another tab, the shell settings page) saved ai-settings.json */
  readonly onSettingsChanged?: ((handler: () => void) => () => void) | undefined
  readonly gskLoggedIn?: (() => Promise<boolean>) | undefined
  /** shell: switch to Home and open Settings › AI Model */
  readonly openModelSettings?: (() => Promise<void> | void) | undefined
  /** shell: switch to Home and open Settings › Account */
  readonly openAccountSettings?: (() => Promise<void> | void) | undefined
  /** shell: trigger or open UniWork sign-in */
  readonly signIn?: (() => Promise<void> | void) | undefined
  /** desktop: read current UniWork cloud status (falls back to window.uniworkCloudStatus.get) */
  readonly getCloudStatus?:
    | (() => Promise<AiModelPickerCloudStatus | null> | AiModelPickerCloudStatus | null)
    | undefined
  /** alias for getCloudStatus */
  readonly cloudStatus?:
    | (() => Promise<AiModelPickerCloudStatus | null> | AiModelPickerCloudStatus | null)
    | AiModelPickerCloudStatus
    | null
    | undefined
  /** desktop: subscribe to UniWork cloud status updates (falls back to window.uniworkCloudStatus.onChanged) */
  readonly onCloudStatusChanged?:
    | ((handler: (status: AiModelPickerCloudStatus | null) => void) => () => void)
    | undefined
  /**
   * web frames: while the chip reads "Choose model" (no key, or a key without a known model) the
   * composer's send stays off with a hint saying which; other hosts leave it undefined
   */
  readonly requireModel?: boolean | undefined
}

interface WindowCloudStatusBridge {
  readonly get?: () => Promise<AiModelPickerCloudStatus | null> | AiModelPickerCloudStatus | null
  readonly onChanged?: (cb: (status: AiModelPickerCloudStatus | null) => void) => () => void
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
  strings: AiModelPickerStrings,
  key: CloudStringKey,
  params?: Record<string, string | number>,
): string {
  const shardTable = (aiUniworkStrings[lang] ?? aiUniworkStrings.en) as Record<
    string,
    string | undefined
  >
  const template = shardTable[key] ?? strings[key]
  if (!params) return template
  return template.replace(/\{([a-zA-Z0-9]+)\}/g, (match, token: string) =>
    token in params ? String(params[token]) : match,
  )
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
 * Composer footer chip showing the active provider + model; the popover lists
 * every usable provider's models for a one-click switch (saved globally, the
 * same ai-settings.json the settings page edits) and ends with a row that
 * opens that page for keys and new vendors.
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
  const [loggedIn, setLoggedIn] = useState(false)
  const [cloudStatus, setCloudStatus] = useState<AiModelPickerCloudStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const bridgeRef = useRef(bridge)
  bridgeRef.current = bridge

  const baseId = useId()
  const listId = `${baseId}-listbox`
  const creditsDescId = `${baseId}-uniwork-credits`
  const groupHeadId = (groupId: string): string => `${baseId}-group-${groupId}`

  // tests render panels without a preload bridge: a throwing getter must not take the panel down
  const refresh = useCallback(() => {
    const b = bridgeRef.current
    Promise.resolve()
      .then(() => b.getSettings())
      .then(setSettings, () => {})
    Promise.resolve()
      .then(() => b.gskLoggedIn?.() ?? false)
      .then(setLoggedIn, () => {})
    if (b.requireModel === true) {
      setCloudStatus(null)
      return
    }
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
    if (b.requireModel !== true) {
      const sub = b.onCloudStatusChanged ?? getWindowCloudStatusBridge()?.onChanged
      try {
        offCloud = sub?.((next) => setCloudStatus(next ?? null))
      } catch {
        offCloud = undefined
      }
    }
    return () => {
      window.removeEventListener('focus', refresh)
      offSettings?.()
      offCloud?.()
    }
  }, [refresh, bridge.requireModel])

  const close = useCallback(() => {
    setOpen(false)
    setFocusKey(null)
  }, [])
  useDismissablePopover(open, close, {
    inside: () => [chipRef.current, popRef.current],
  })

  const groups = useMemo(
    () => (settings ? aiModelPickerGroups(settings, loggedIn) : []),
    [settings, loggedIn],
  )
  const flatOptions = useMemo(
    () =>
      groups.flatMap((g) =>
        (g.models.length > 0 ? g.models : ['']).map((m) => ({
          provider: g.id,
          model: m,
          key: `${g.id}:${m}`,
        })),
      ),
    [groups],
  )
  const current = settings ? aiModelPickerSelection(settings) : null
  const currentUsable = groups.some((g) => g.id === current?.provider)
  const selectedKey = current ? `${current.provider}:${current.model}` : null
  const hasOptionKey = (k: string | null): boolean =>
    k !== null && flatOptions.some((o) => o.key === k)
  const activeKey = hasOptionKey(focusKey)
    ? focusKey!
    : hasOptionKey(selectedKey)
      ? selectedKey!
      : (flatOptions[0]?.key ?? null)

  // the wanted provider is read raw (a key list that failed to load masks nothing here)
  const wanted = settings?.provider
  const wantedConfig = wanted ? settings?.providers?.[wanted] : undefined
  const hasKey = (wantedConfig?.apiKey ?? '') !== ''
  // The chip reads "Choose model" while the chosen provider cannot send yet; the composer's send
  // is then off and the hint says what is missing: a model (a key is stored) or a key. This holds
  // on every host: a chosen vendor is never swapped for UniAI, so the chip and the request agree.
  // Web frames apply it to UniAI too (nothing usable at all). A key list that failed to load says
  // nothing about keys: no hint, send stays on, the server decides
  const need = settings ? aiModelPickerNeed(settings) : null
  const needHint =
    settings !== null && !currentUsable && settings.credentialsUnavailable !== true
      ? need === 'base-url'
        ? strings.needBaseUrl
        : bridge.requireModel === true
          ? hasKey
            ? strings.needModel
            : strings.needKey
          : need === 'model'
            ? strings.needModel
            : need === 'key'
              ? strings.needKey
              : null
      : null
  const openSettings = bridge.openModelSettings
  const openSettingsOnce = useCallback(() => {
    void openSettings?.()
  }, [openSettings])
  useEffect(() => {
    setAiModelNeedHint(needHint, openSettings ? openSettingsOnce : null)
    return () => setAiModelNeedHint(null)
  }, [needHint, openSettings, openSettingsOnce])

  const toggle = () => {
    // a key list that failed to load is tried again when the chip is opened (and on focus)
    if (!open && settings?.credentialsUnavailable) refresh()
    if (!open) {
      const rect = chipRef.current?.getBoundingClientRect()
      // the composer sits at the panel bottom: open upwards, pinned to the chip
      if (rect) setPopStyle({ left: rect.left, bottom: window.innerHeight - rect.top + 6 })
      setFocusKey(null)
    }
    setOpen((v) => !v)
  }

  const pick = (sel: AiModelPickerSelection) => {
    const pop = popRef.current
    setOpen(false)
    setFocusKey(null)
    if (settings) {
      const next = withAiModelSelection(settings, sel)
      setSettings(next)
      void bridge.setSettings(next).catch(() => {})
    }
    restoreChipFocusUnlessMoved(chipRef.current, pop)
  }

  const manage = () => {
    const pop = popRef.current
    setOpen(false)
    setFocusKey(null)
    void bridge.openModelSettings?.()
    restoreChipFocusUnlessMoved(chipRef.current, pop)
  }

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (flatOptions.length === 0) return
    const currentIdx = Math.max(
      0,
      flatOptions.findIndex((o) => o.key === activeKey),
    )
    let nextIdx = currentIdx
    if (e.key === 'ArrowDown') {
      nextIdx = Math.min(flatOptions.length - 1, currentIdx + 1)
    } else if (e.key === 'ArrowUp') {
      nextIdx = Math.max(0, currentIdx - 1)
    } else if (e.key === 'Home') {
      nextIdx = 0
    } else if (e.key === 'End') {
      nextIdx = flatOptions.length - 1
    } else {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const target = flatOptions[nextIdx]
    if (!target) return
    setFocusKey(target.key)
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')
    buttons?.[nextIdx]?.focus()
  }

  const desktopCredits =
    bridge.requireModel !== true && cloudStatus?.credits ? cloudStatus.credits : null
  const creditsVisibleText = desktopCredits
    ? desktopCredits.limit === null
      ? pickerCloudText(lang, strings, 'cloudCreditsUnlimited')
      : pickerCloudText(lang, strings, 'cloudCreditsLeft', {
          remaining: desktopCredits.remaining,
          limit: desktopCredits.limit,
        })
    : null
  const creditsAriaText = desktopCredits
    ? desktopCredits.limit === null
      ? pickerCloudText(lang, strings, 'cloudCreditsUnlimited')
      : aiUniworkText(lang, 'aiUniworkCreditsAria', {
          remaining: desktopCredits.remaining,
          limit: desktopCredits.limit,
        })
    : null

  const footerInfo = useMemo(() => {
    if (bridge.requireModel === true || !cloudStatus || cloudStatus.hasCompletedRead === false) {
      return null
    }
    switch (cloudStatus.state) {
      case 'signed-out':
        return {
          text: aiUniworkText(lang, 'aiUniworkFooterSignIn'),
          actionLabel: pickerCloudText(lang, strings, 'acctSignIn'),
          kind: 'sign-in' as const,
        }
      case 'not-entitled':
        return {
          text: pickerCloudText(lang, strings, 'cloudStateNotEntitled'),
          actionLabel: aiUniworkText(lang, 'aiUniworkDetails'),
          kind: 'details' as const,
        }
      case 'subscription-inactive':
        return {
          text: pickerCloudText(lang, strings, 'cloudStateInactive'),
          actionLabel: aiUniworkText(lang, 'aiUniworkDetails'),
          kind: 'details' as const,
        }
      case 'credits-exhausted':
        return {
          text: pickerCloudText(lang, strings, 'cloudStateExhausted'),
          actionLabel: aiUniworkText(lang, 'aiUniworkDetails'),
          kind: 'details' as const,
        }
      case 'unavailable':
        if (cloudStatus.cloudUnavailable === true || cloudStatus.reason === 'cloud_unavailable') {
          return {
            text: pickerCloudText(lang, strings, 'cloudStateUnavailable'),
            actionLabel: aiUniworkText(lang, 'aiUniworkDetails'),
            kind: 'details' as const,
          }
        }
        return null
      case 'ready':
      default:
        return null
    }
  }, [bridge.requireModel, cloudStatus, lang, strings])

  const onFooterAction = () => {
    const pop = popRef.current
    setOpen(false)
    setFocusKey(null)
    if (footerInfo?.kind === 'sign-in') {
      void (bridge.signIn ?? bridge.openAccountSettings ?? bridge.openModelSettings)?.()
    } else {
      void (bridge.openAccountSettings ?? bridge.openModelSettings)?.()
    }
    restoreChipFocusUnlessMoved(chipRef.current, pop)
  }

  if (!settings) return null
  const chipText =
    currentUsable && current
      ? current.model || groupLabel(groups, current.provider)
      : strings.choose

  return (
    <div
      className="ai-model-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
          setFocusKey(null)
          chipRef.current?.focus()
        }
      }}
    >
      <button
        ref={chipRef}
        type="button"
        className={`ai-model-chip${open ? ' open' : ''}`}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-tip={strings.title}
        aria-label={`${strings.title}: ${chipText}`}
      >
        {currentUsable && current && <ProviderLogo id={current.provider} />}
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
          className="ai-model-pop"
          role="group"
          aria-label={strings.choose}
          style={popStyle}
        >
          <div
            ref={listRef}
            id={listId}
            className="ai-model-pop-list"
            role="listbox"
            aria-label={strings.title}
            onKeyDown={onListKeyDown}
          >
            {groups.map((g) => {
              const headId = groupHeadId(g.id)
              return (
                <div
                  key={g.id}
                  className="ai-model-group"
                  role="group"
                  aria-labelledby={headId}
                >
                  <div id={headId} className="ai-model-group-head">
                    <ProviderLogo id={g.id} />
                    <span>{g.label}</span>
                  </div>
                  {(g.models.length > 0 ? g.models : ['']).map((m) => {
                    const optionKey = `${g.id}:${m}`
                    const selected = current?.provider === g.id && current.model === m
                    const isUniworkWithCredits =
                      g.id === 'uniwork' &&
                      creditsVisibleText !== null &&
                      creditsAriaText !== null
                    return (
                      <React.Fragment key={optionKey}>
                        <button
                          type="button"
                          role="option"
                          tabIndex={optionKey === activeKey ? 0 : -1}
                          aria-selected={selected}
                          aria-describedby={isUniworkWithCredits ? creditsDescId : undefined}
                          className={`ai-model-item${selected ? ' selected' : ''}${isUniworkWithCredits ? ' ai-model-item-with-sub' : ''}`}
                          onFocus={() => setFocusKey(optionKey)}
                          onClick={() => pick({ provider: g.id, model: m })}
                        >
                          <span className="ai-model-item-body">
                            <span className="ai-model-item-text">{m || g.label}</span>
                            {isUniworkWithCredits && (
                              <span className="ai-model-item-sub" aria-hidden="true">
                                {creditsVisibleText}
                              </span>
                            )}
                          </span>
                          {selected && (
                            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                              <path
                                d="M2.5 6.5 5 9l4.5-6"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                        {isUniworkWithCredits && (
                          <span id={creditsDescId} className="ai-model-sr-only">
                            {creditsAriaText}
                          </span>
                        )}
                      </React.Fragment>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {bridge.openModelSettings && (
            <button type="button" className="ai-model-item ai-model-manage" onClick={manage}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
              <span className="ai-model-item-text">{strings.manage}</span>
            </button>
          )}
          {footerInfo && (
            <div className="ai-model-footer">
              <span className="ai-model-footer-text">{footerInfo.text}</span>
              <button
                type="button"
                className="ai-model-footer-action"
                onClick={onFooterAction}
              >
                {footerInfo.actionLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function groupLabel(groups: ReadonlyArray<{ id: string; label: string }>, id: string): string {
  return groups.find((g) => g.id === id)?.label ?? id
}
