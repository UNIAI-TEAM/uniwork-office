import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type {
  AiProviderId,
  AiSettings,
  AiSettingsSaveOptions,
} from '@genoffice/ai-provider/browser'
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
  readonly getSettings: () => Promise<AiSettings>
  /** `options.modelPick` names the model the user chose; main records a pick only from that */
  readonly setSettings: (settings: AiSettings, options?: AiSettingsSaveOptions) => Promise<void>
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
    (() => Promise<AiModelPickerCloudStatus | null> | AiModelPickerCloudStatus | null) | undefined
  /** alias for getCloudStatus */
  readonly cloudStatus?:
    | (() => Promise<AiModelPickerCloudStatus | null> | AiModelPickerCloudStatus | null)
    | AiModelPickerCloudStatus
    | null
    | undefined
  /** desktop: subscribe to UniWork cloud status updates (falls back to window.uniworkCloudStatus.onChange) */
  readonly onCloudStatusChanged?:
    ((handler: (status: AiModelPickerCloudStatus | null) => void) => () => void) | undefined
  /**
   * web frames: while the chip reads "Choose model" (no key, or a key without a known model) the
   * composer's send stays off with a hint saying which; other hosts leave it undefined
   */
  readonly requireModel?: boolean | undefined
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

const ORG_NOTE_SEEN_PREFIX = 'uniwork.ai.orgKeyNoteSeen.'

/** whether this machine already showed the first-use privacy note of a key-on-UniWork provider */
function readOrgNoteSeen(provider: string): boolean {
  try {
    return window.localStorage.getItem(ORG_NOTE_SEEN_PREFIX + provider) === '1'
  } catch {
    return false
  }
}

function writeOrgNoteSeen(provider: string): void {
  try {
    window.localStorage.setItem(ORG_NOTE_SEEN_PREFIX + provider, '1')
  } catch {
    // storage blocked: the in-memory set of the picker still keeps it quiet until the next start
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
  onAnnounce,
}: {
  readonly bridge: AiModelPickerBridge
  readonly lang: Lang
  /**
   * The host panel's fixed polite live node: the list note is written into it after the popover
   * opens. The picker mounts no live region of its own, so without this prop it announces nothing.
   */
  readonly onAnnounce?: ((text: string) => void) | undefined
}): React.JSX.Element | null {
  const strings = AI_MODEL_PICKER_STRINGS[lang] ?? AI_MODEL_PICKER_STRINGS.en
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const [cloudStatus, setCloudStatus] = useState<AiModelPickerCloudStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  // providers whose first-use note was shown once (open + close); persisted per provider, and kept
  // here too so a blocked store still stops the re-announcing while the window lives
  const [seenOrgNotes, setSeenOrgNotes] = useState<ReadonlySet<string>>(() => new Set())
  const shownOrgNotesRef = useRef<Set<string>>(new Set())
  const orgDescId = useId()
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
  const refreshSettings = useCallback(() => {
    const b = bridgeRef.current
    Promise.resolve()
      .then(() => b.getSettings())
      .then(setSettings, () => {})
    Promise.resolve()
      .then(() => b.gskLoggedIn?.() ?? false)
      .then(setLoggedIn, () => {})
  }, [])

  // mount, window focus and settings changes also re-read the cloud status; opening the popover
  // does not (the status has its own change feed, and credits are not re-fetched per open)
  const refresh = useCallback(() => {
    const b = bridgeRef.current
    refreshSettings()
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
  }, [refreshSettings])

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
      const winCloud = getWindowCloudStatusBridge()
      const sub = b.onCloudStatusChanged ?? winCloud?.onChange ?? winCloud?.onChanged
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

  const hideUniworkByCloudStatus =
    bridge.requireModel !== true &&
    cloudStatus !== null &&
    cloudStatus.hasCompletedRead !== false &&
    (cloudStatus.state !== 'ready' || cloudStatus.enabled === false)

  const groups = useMemo(() => {
    const raw = settings ? aiModelPickerGroups(settings, loggedIn) : []
    return hideUniworkByCloudStatus ? raw.filter((g) => g.id !== 'uniwork') : raw
  }, [settings, loggedIn, hideUniworkByCloudStatus])
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
<<<<<<< ours
  const isOrgGroup = (id: string) => settings?.modelSources?.[id as AiProviderId]?.origin === 'org'
  const hasOrgGroup = groups.some((g) => isOrgGroup(g.id))
  const noteDue = (id: string) => isOrgGroup(id) && !seenOrgNotes.has(id) && !readOrgNoteSeen(id)
  const orgNoteDue = groups.some((g) => noteDue(g.id))
  // what the listbox's quiet notes say, read out once through a live region beside the listbox
  const listNote = [
    ...[...new Set(groups.map((g) => g.listState))].map((state) =>
      state === 'loading' ? strings.modelsLoading : state ? strings.modelsUnavailable : '',
    ),
    orgNoteDue ? strings.orgKeyNote : '',
  ]
    .filter(Boolean)
    .join('. ')
  const rawCurrent = settings ? aiModelPickerSelection(settings) : null
  // an org-served provider's model is what main resolved (modelSources[id].chosen); the local slot
  // never carries a copy of it
  const orgChosen = rawCurrent ? (settings?.modelSources?.[rawCurrent.provider]?.chosen ?? '') : ''
  const current: AiModelPickerSelection | null =
    rawCurrent && isOrgGroup(rawCurrent.provider) && orgChosen.trim()
      ? { provider: rawCurrent.provider, model: orgChosen.trim() }
      : rawCurrent
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
  const need = settings
    ? current?.provider === 'uniwork' && !currentUsable
      ? 'model'
      : aiModelPickerNeed(settings)
    : null
  const needHint =
    settings !== null && !currentUsable && settings.credentialsUnavailable !== true
      ? need === 'base-url'
        ? strings.needBaseUrl
        : bridge.requireModel === true
          ? hasKey || current?.provider === 'uniwork'
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

  // the note goes into the host panel's fixed polite node once the popover is open (Accessibility
  // Floor: live nodes exist from load and are never mounted at runtime)
  const onAnnounceRef = useRef(onAnnounce)
  onAnnounceRef.current = onAnnounce
  useEffect(() => {
    if (open && listNote) onAnnounceRef.current?.(listNote)
  }, [open, listNote])

  // the first-use note counts as read once it was on screen and the popover closed again
  const shownIds = groups
    .filter((g) => noteDue(g.id))
    .map((g) => g.id)
    .join('\n')
  useEffect(() => {
    if (open) {
      for (const id of shownIds ? shownIds.split('\n') : []) shownOrgNotesRef.current.add(id)
      return
    }
    const shown = [...shownOrgNotesRef.current]
    if (shown.length === 0) return
    shownOrgNotesRef.current.clear()
    for (const id of shown) writeOrgNoteSeen(id)
    setSeenOrgNotes((prev) => new Set([...prev, ...shown]))
  }, [open, shownIds])
=======
  const current = settings ? aiModelPickerSelection(settings) : null
  const sameGroup = (g: { id: string; endpoint?: string | undefined }) =>
    g.id === current?.provider && (g.id !== 'custom' || g.endpoint === current?.endpoint)
  const currentUsable = groups.some(sameGroup)
>>>>>>> theirs

  const toggle = () => {
    // every open re-reads the settings (host data: Settings pick, live lists, served model); a host
    // answers from its cache and announces a newer listing through onSettingsChanged
    if (!open) {
      refreshSettings()
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
      setFocusKey(null)
    }
    setOpen((v) => !v)
  }

  // opening moves focus into the list, onto the selected (else first) option, so arrows work at once.
  // Once per open: later settings refreshes must not pull focus back. A host that has no option at
  // the open edge (the read an open triggers is what finds the model) gets it when the first one
  // arrives, unless focus went elsewhere meanwhile
  const focusedThisOpenRef = useRef(false)
  const hasOptions = flatOptions.length > 0
  useEffect(() => {
    if (!open) {
      focusedThisOpenRef.current = false
      return
    }
    if (focusedThisOpenRef.current || !hasOptions) return
    const active = document.activeElement
    const stayed =
      !active ||
      active === document.body ||
      Boolean(chipRef.current?.contains(active)) ||
      Boolean(popRef.current?.contains(active))
    if (!stayed) return
    const option = listRef.current?.querySelector<HTMLButtonElement>(
      '[role="option"][tabindex="0"]',
    )
    if (!option) return
    option.focus()
    focusedThisOpenRef.current = true
  }, [open, hasOptions])

  const onChipKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    e.stopPropagation()
    if (open) {
      listRef.current?.querySelector<HTMLButtonElement>('[role="option"][tabindex="0"]')?.focus()
    } else {
      toggle()
    }
  }

  const pick = (sel: AiModelPickerSelection) => {
    const pop = popRef.current
    setOpen(false)
    setFocusKey(null)
    if (settings) {
      const picked = withAiModelSelection(settings, sel)
      const source = settings.modelSources?.[sel.provider]
      // the chip reads an org-served provider's model from its source: show the pick there too
      const next: AiSettings =
        source?.origin === 'org'
          ? {
              ...picked,
              modelSources: {
                ...settings.modelSources,
                [sel.provider]: { ...source, chosen: sel.model },
              },
            }
          : picked
      setSettings(next)
      void bridge
        .setSettings(next, { modelPick: { provider: sel.provider, model: sel.model } })
        .catch(() => {})
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
    let nextIdx: number
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
      ? pickerCloudText(lang, 'cloudCreditsUnlimited')
      : desktopCredits.remaining !== null
        ? pickerCloudText(lang, 'cloudCreditsLeft', {
            remaining: formatCreditCount(lang, desktopCredits.remaining),
            limit: formatCreditCount(lang, desktopCredits.limit),
          })
        : null
    : null
  const creditsAriaText = desktopCredits
    ? desktopCredits.limit === null
      ? pickerCloudText(lang, 'cloudCreditsUnlimited')
      : desktopCredits.remaining !== null
        ? aiUniworkText(lang, 'aiUniworkCreditsAria', {
            remaining: formatCreditCount(lang, desktopCredits.remaining),
            limit: formatCreditCount(lang, desktopCredits.limit),
          })
        : null
    : null
  const hasUniworkWithCredits =
    groups.some((g) => g.id === 'uniwork') &&
    creditsVisibleText !== null &&
    creditsAriaText !== null

  const footerInfo = useMemo(() => {
    if (bridge.requireModel === true || !cloudStatus || cloudStatus.hasCompletedRead === false) {
      return null
    }
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
  }, [bridge.requireModel, cloudStatus, lang])

  const onFooterAction = () => {
    const pop = popRef.current
    setOpen(false)
    setFocusKey(null)
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
  const chipText =
    currentUsable && current
      ? current.model || (groups.find(sameGroup)?.label ?? '')
      : strings.choose
  const chipLabel = `${strings.title}: ${chipText}`

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
        onKeyDown={onChipKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
<<<<<<< ours
        aria-controls={open ? listId : undefined}
        title={chipLabel}
        data-tip={chipLabel}
        aria-label={chipLabel}
=======
        data-tip={`${strings.title}: ${chipText}`}
        aria-label={`${strings.title}: ${chipText}`}
>>>>>>> theirs
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
<<<<<<< ours
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
              const isOrg = isOrgGroup(g.id)
              return (
                <div
                  key={g.id}
                  className="ai-model-group"
                  role="group"
                  aria-labelledby={headId}
                  data-origin={isOrg ? 'org' : undefined}
                >
                  <div id={headId} className="ai-model-group-head">
                    <ProviderLogo id={g.id} />
                    <span>{g.label}</span>
                    {isOrg && (
                      <span
                        data-org-key-tag=""
                        title={strings.orgKeyNote}
                        data-tip={strings.orgKeyNote}
                        className="ai-model-org-tag"
                      >
                        {strings.orgKeyTag}
                      </span>
                    )}
                  </div>
                  {isOrg && noteDue(g.id) && (
                    <div
                      className="ai-model-group-head ai-model-org-note"
                      role="presentation"
                      aria-hidden
                      data-org-key-note=""
=======
          <div className="ai-model-pop-list">
            {groups.map((g) => (
              <div key={g.endpoint ? `${g.id}:${g.endpoint}` : g.id} className="ai-model-group">
                <div className="ai-model-group-head">
                  <ProviderLogo id={g.id} />
                  <span>{g.label}</span>
                </div>
                {(g.models.length > 0 ? g.models : ['']).map((m) => {
                  const selected = sameGroup(g) && current?.model === m
                  return (
                    <button
                      key={`${g.id}:${g.endpoint ?? ''}:${m}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`ai-model-item${selected ? ' selected' : ''}`}
                      onClick={() => pick({ provider: g.id, endpoint: g.endpoint, model: m })}
>>>>>>> theirs
                    >
                      {strings.orgKeyNote}
                    </div>
                  )}
                  {g.listState && (
                    // plain text for sighted users; screen readers get it from the live region
                    // outside the listbox, since a listbox may only own options and groups
                    <div className="ai-model-group-head" role="presentation" aria-hidden>
                      {g.listState === 'loading'
                        ? strings.modelsLoading
                        : strings.modelsUnavailable}
                    </div>
                  )}
                  {(g.models.length > 0 ? g.models : ['']).map((m) => {
                    const optionKey = `${g.id}:${m}`
                    const selected = current?.provider === g.id && current.model === m
                    const isUniworkWithCredits = g.id === 'uniwork' && hasUniworkWithCredits
                    return (
                      <button
                        key={optionKey}
                        type="button"
                        role="option"
                        tabIndex={optionKey === activeKey ? 0 : -1}
                        aria-selected={selected}
                        aria-describedby={
                          isUniworkWithCredits ? creditsDescId : isOrg ? orgDescId : undefined
                        }
                        className={`ai-model-item${selected ? ' selected' : ''}${isUniworkWithCredits ? ' ai-model-item-with-sub' : ''}`}
                        onFocus={() => setFocusKey(optionKey)}
                        onClick={() => pick({ provider: g.id, model: m })}
                      >
                        <span className="ai-model-item-body">
                          <span className="ai-model-item-text">{m || g.rowLabel}</span>
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
                    )
                  })}
                </div>
              )
            })}
          </div>
          {hasUniworkWithCredits && (
            <span id={creditsDescId} className="ai-model-sr-only">
              {creditsAriaText}
            </span>
          )}
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
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0-4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
              <span className="ai-model-item-text">{strings.manage}</span>
            </button>
          )}
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
      {open && hasOrgGroup && (
        // what an option of a key-on-UniWork group is described by: where its prompt goes
        <div hidden id={orgDescId}>
          {strings.orgKeyTag}. {strings.orgKeyNote}
        </div>
      )}
    </div>
  )
}
<<<<<<< ours

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

function groupLabel(groups: ReadonlyArray<{ id: string; label: string }>, id: string): string {
  return groups.find((g) => g.id === id)?.label ?? id
}
=======
>>>>>>> theirs
