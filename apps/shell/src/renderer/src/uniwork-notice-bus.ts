import type { UniworkLaunchEvent } from '../../shared/home-api'

/**
 * In-renderer feed into the launch notice in the tab strip. Main pushes launch
 * events (onUniworkLaunch); a failure the renderer sees itself (opening a
 * UniWork recent that cannot be fetched) goes through here so it lands in the
 * same, always-visible place instead of a window alert.
 */
const target = new EventTarget()
const NOTICE = 'uniwork-notice'

export function publishUniworkNotice(event: UniworkLaunchEvent): void {
  target.dispatchEvent(new CustomEvent<UniworkLaunchEvent>(NOTICE, { detail: event }))
}

/** Subscribe; returns the unsubscribe function (effect-cleanup friendly). */
export function onUniworkNotice(handler: (event: UniworkLaunchEvent) => void): () => void {
  const listener = (ev: Event): void => handler((ev as CustomEvent<UniworkLaunchEvent>).detail)
  target.addEventListener(NOTICE, listener)
  return () => target.removeEventListener(NOTICE, listener)
}
