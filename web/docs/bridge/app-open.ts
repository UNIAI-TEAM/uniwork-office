/**
 * "Open in the UniWork Office app" from a frame (A7 contract, protocol README "Open in desktop app").
 *
 * A frame never builds a deep link: it sends the one `app.open` request and the host runs its own
 * flow (deep link, installer prompt, unsaved-changes dialog). Rules this helper keeps in one place:
 *   - only with the effective capability `desktopOpen` (default false, granted by the host while its
 *     own action is available); without it nothing is sent and the frame shows the message only;
 *   - no request timeout: the host may wait on its unsaved-changes dialog for as long as the user takes;
 *   - `unavailable` means the host already showed its own alert, and a rejected request (an old host
 *     answering `unsupported`, a lost connection) must not surface a raw error either: both resolve
 *     `unavailable` and the frame shows nothing more.
 */
import type { AppOpenOutcome } from '../protocol/types'
import { TIMEOUTS } from './frame-port'
import type { ModuleBridgePort } from './module-bridge'

/** `desktopOpen` must be explicitly granted (an unset key reads as "on" in capEnabled, so test the value) */
export function appOpenGranted(caps: object | null | undefined): boolean {
  return (caps as Record<string, unknown> | null | undefined)?.desktopOpen === true
}

export function createAppOpen(
  port: Pick<ModuleBridgePort, 'request'>,
  capabilities: object,
): (feature?: string) => Promise<{ outcome: AppOpenOutcome }> {
  return async (feature) => {
    if (!appOpenGranted(capabilities)) {
      return { outcome: 'unavailable' }
    }
    try {
      return await port.request('app.open', feature ? { feature } : {}, {
        timeoutMs: TIMEOUTS.dialog,
      })
    } catch {
      return { outcome: 'unavailable' }
    }
  }
}
