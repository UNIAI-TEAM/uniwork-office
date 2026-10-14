import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { AI_MODEL_PICKER_STRINGS } from './strings-ai-model-picker'

/** Each app's preload exposes these under its own namespace; the panel adapts them. */
export interface AiModelPickerBridge {
  readonly getSettings: () => Promise<AiSettings>
  readonly setSettings: (settings: AiSettings) => Promise<void>
  /** fires after any renderer (this one, another tab, the shell settings page) saved ai-settings.json */
  readonly onSettingsChanged?: ((handler: () => void) => () => void) | undefined
  readonly gskLoggedIn?: (() => Promise<boolean>) | undefined
  /** shell: switch to Home and open Settings › AI Model */
  readonly openModelSettings?: (() => Promise<void> | void) | undefined
  /**
   * web frames: while the chip reads "Choose model" (no key, or a key without a known model) the
   * composer's send stays off with a hint saying which; other hosts leave it undefined
   */
  readonly requireModel?: boolean | undefined
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
  const [open, setOpen] = useState(false)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)

  // tests render panels without a preload bridge: a throwing getter must not take the panel down
  const refresh = useCallback(() => {
    Promise.resolve()
      .then(() => bridge.getSettings())
      .then(setSettings, () => {})
    Promise.resolve()
      .then(() => bridge.gskLoggedIn?.() ?? false)
      .then(setLoggedIn, () => {})
  }, [bridge])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    let off: (() => void) | undefined
    try {
      off = bridge.onSettingsChanged?.(refresh)
    } catch {
      off = undefined
    }
    return () => {
      window.removeEventListener('focus', refresh)
      off?.()
    }
  }, [bridge, refresh])

  const close = useCallback(() => setOpen(false), [])
  useDismissablePopover(open, close, {
    inside: () => [chipRef.current, popRef.current],
  })

  const groups = useMemo(
    () => (settings ? aiModelPickerGroups(settings, loggedIn) : []),
    [settings, loggedIn],
  )
  // what the listbox's quiet notes say, read out once through a live region beside the listbox
  const listNote = [...new Set(groups.map((g) => g.listState))]
    .map((state) =>
      state === 'loading' ? strings.modelsLoading : state ? strings.modelsUnavailable : '',
    )
    .filter(Boolean)
    .join('. ')
  const current = settings ? aiModelPickerSelection(settings) : null
  const currentUsable = groups.some((g) => g.id === current?.provider)
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
    // every open re-reads the settings (host data: Settings pick, live lists, served model); a host
    // answers from its cache and announces a newer listing through onSettingsChanged
    if (!open) {
      refresh()
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

  const pick = (sel: AiModelPickerSelection) => {
    setOpen(false)
    if (!settings) return
    const next = withAiModelSelection(settings, sel)
    setSettings(next)
    void bridge.setSettings(next).catch(() => {})
  }

  const manage = () => {
    setOpen(false)
    void bridge.openModelSettings?.()
  }

  if (!settings) return null
  const chipText =
    currentUsable && current
      ? current.model || groupLabel(groups, current.provider)
      : strings.choose
  const chipLabel = `${strings.title}: ${chipText}`

  return (
    <div
      className="ai-model-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
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
        aria-haspopup="listbox"
        aria-expanded={open}
        title={chipLabel}
        data-tip={chipLabel}
        aria-label={chipLabel}
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
          role="listbox"
          aria-label={strings.title}
          style={popStyle}
        >
          <div className="ai-model-pop-list">
            {groups.map((g) => (
              <div key={g.id} className="ai-model-group">
                <div className="ai-model-group-head">
                  <ProviderLogo id={g.id} />
                  <span>{g.label}</span>
                </div>
                {g.listState && (
                  // plain text for sighted users; screen readers get it from the live region
                  // outside the listbox, since a listbox may only own options and groups
                  <div className="ai-model-group-head" role="presentation" aria-hidden>
                    {g.listState === 'loading' ? strings.modelsLoading : strings.modelsUnavailable}
                  </div>
                )}
                {(g.models.length > 0 ? g.models : ['']).map((m) => {
                  const selected = current?.provider === g.id && current.model === m
                  return (
                    <button
                      key={`${g.id}:${m}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`ai-model-item${selected ? ' selected' : ''}`}
                      onClick={() => pick({ provider: g.id, model: m })}
                    >
                      <span className="ai-model-item-text">{m || g.rowLabel}</span>
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
            ))}
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
        </div>
      )}
      <div aria-live="polite" style={VISUALLY_HIDDEN}>
        {open ? listNote : ''}
      </div>
    </div>
  )
}

/** screen-reader-only: the box stays in the layout flow but takes no space and shows nothing */
const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

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
