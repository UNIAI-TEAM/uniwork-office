import { useSyncExternalStore } from 'react'
import {
  DEFAULT_AI_PANEL_PREFS,
  aiPanelZoom,
  normalizeAiPanelPrefs,
  sameAiPanelPrefs,
  type AiPanelPrefs,
} from './ai-panel-prefs'

let current: AiPanelPrefs = DEFAULT_AI_PANEL_PREFS
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Renderer-side entry for the shell's AI panel preferences: mirrors the font
 * size onto `<html data-ai-font-size>` plus `--ai-font-zoom` (see
 * ai-panel-prefs.css) and feeds `useAiPanelPrefs()` consumers such as the
 * composer's spellcheck flag.
 */
export function applyAiPanelPrefs(raw: unknown): void {
  const next = normalizeAiPanelPrefs(raw)
  if (sameAiPanelPrefs(next, current)) return
  current = next
  const html = document.documentElement
  html.dataset.aiPanelSide = next.side
  if (next.fontSize === 'default') {
    delete html.dataset.aiFontSize
    html.style.removeProperty('--ai-font-zoom')
  } else {
    html.dataset.aiFontSize = next.fontSize
    html.style.setProperty('--ai-font-zoom', String(aiPanelZoom(next)))
  }
  for (const listener of listeners) listener()
}

/** Panels meet the window edge on either side; each app retains its own width limits. */
export function aiPanelWidthAtPointer(clientX: number): number {
  return current.side === 'right' ? window.innerWidth - clientX : clientX
}

/**
 * Below this window width the panel would take most of the screen and leave the document a sliver
 * (a phone, a narrow browser tab), so it starts closed until the user opens it.
 */
export const AI_PANEL_NARROW_PX = 900

function openByDefault(): boolean {
  return typeof window === 'undefined' || window.innerWidth >= AI_PANEL_NARROW_PX
}

/**
 * Initial open state of an app's AI panel: the app's remembered last state,
 * unless the user turned off "open the AI panel in new documents". Nothing
 * remembered yet: open, except in a narrow window (AI_PANEL_NARROW_PX). Call
 * after the shell prefs have been applied (the apps await them before first
 * render).
 */
export function aiPanelInitiallyOpen(storageKey: string): boolean {
  if (!current.openInNewDocs) return false
  const remembered = localStorage.getItem(storageKey)
  return remembered === null ? openByDefault() : remembered !== '0'
}

/**
 * Persist the panel state for `aiPanelInitiallyOpen`; a no-op while the setting is off so the
 * memory survives, and while nothing is remembered and the state is just the width-based default
 * (a narrow first run must not turn into a "closed" memory for later wide windows).
 */
export function rememberAiPanelOpen(storageKey: string, open: boolean): void {
  if (!current.openInNewDocs) return
  if (localStorage.getItem(storageKey) === null && open === openByDefault()) return
  localStorage.setItem(storageKey, open ? '1' : '0')
}

export function useAiPanelPrefs(): AiPanelPrefs {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_AI_PANEL_PREFS,
  )
}
