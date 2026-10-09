/**
 * UniWork launch events can reach the preload before the renderer has
 * subscribed (a cold start from an "Open in desktop app" link). The latest
 * event that found no subscriber is held and handed to the next subscriber,
 * once, while it is still recent (the launch ticket's lifetime).
 */

export const LAUNCH_REPLAY_MS = 120_000

export interface LaunchReplay<E> {
  deliver(event: E): void
  subscribe(cb: (event: E) => void): () => void
}

export function createLaunchReplay<E>(now: () => number = Date.now): LaunchReplay<E> {
  const subscribers = new Set<(event: E) => void>()
  let held: { event: E; at: number } | null = null
  return {
    deliver(event) {
      if (subscribers.size === 0) {
        held = { event, at: now() }
        return
      }
      for (const cb of [...subscribers]) cb(event)
    },
    subscribe(cb) {
      subscribers.add(cb)
      const pending = held
      held = null
      if (pending && now() - pending.at <= LAUNCH_REPLAY_MS) cb(pending.event)
      return () => {
        subscribers.delete(cb)
      }
    },
  }
}
