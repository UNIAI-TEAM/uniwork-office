import { useSyncExternalStore } from 'react'

/**
 * The one owner of the band reserved under the tab strip. Main has a single top inset for the
 * active editor view (`uniworkSetBarInset` -> `TabManager.setTopInset`); two shell surfaces hang
 * below the strip in that band: the new-version bar (S6) and the open queue popover (S4). Each
 * reports its own unscaled CSS-px height here and main always gets the SUM, so one never
 * overwrites the other. Shell DOM below the strip is only visible inside this band: the editor
 * view covers the rest of the window.
 */

export type TopInsetPart = 'bar' | 'popover'

const parts: Record<TopInsetPart, number> = { bar: 0, popover: 0 }
const listeners = new Set<() => void>()

function send(total: number): void {
  try {
    void Promise.resolve(window.aiOffice.uniworkSetBarInset(total)).catch(() => undefined)
  } catch {
    // a host without the channel has no inset to move
  }
}

/** the total main is asked for: the bar first, the popover band right below it */
export function topInsetTotal(): number {
  return parts.bar + parts.popover
}

export function topInsetPart(part: TopInsetPart): number {
  return parts[part]
}

/**
 * Set one surface's height (0 = gone) and send the total. Every call sends, also an unchanged
 * total: the bar resends on a tab switch so the view that becomes active gets it.
 */
export function setTopInsetPart(part: TopInsetPart, px: number): void {
  const next = Number.isFinite(px) ? Math.max(0, Math.ceil(px)) : 0
  const changed = parts[part] !== next
  parts[part] = next
  send(topInsetTotal())
  if (changed) for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** one part's current height, re-rendering on change (the popover sits below the bar) */
export function useTopInsetPart(part: TopInsetPart): number {
  return useSyncExternalStore(
    subscribe,
    () => parts[part],
    () => parts[part],
  )
}

/** the interface scale (`zoom: var(--ui-scale)` on the frame) an element is drawn at */
export function uiScaleOf(el: HTMLElement): number {
  const rawScale = Number.parseFloat(
    getComputedStyle(el).getPropertyValue('--ui-scale') ||
      document.documentElement.style.getPropertyValue('--ui-scale'),
  )
  return Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1
}

/** an element's height in unscaled CSS px (main multiplies the inset by the interface scale) */
export function unscaledHeightOf(el: HTMLElement): number {
  return Math.ceil(el.getBoundingClientRect().height / uiScaleOf(el))
}
