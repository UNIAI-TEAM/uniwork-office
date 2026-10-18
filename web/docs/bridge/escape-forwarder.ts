/**
 * Shared read-only profile predicate and window-level Escape forwarder (UNI-1876).
 *
 * Used by Docs (`web/docs/bridge/`) and the module bridges (`web/docs/bridge/module-bridge.ts`,
 * `web/modules/<module>/`) to:
 *   1. check whether the `init` payload or initialized session sets `profile: 'readOnly'`
 *      (`isReadOnlyProfile`, re-exported from `../protocol/types`), and
 *   2. forward unhandled `Escape` keydowns in the bubble phase to the host as
 *      `close_requested { reason: 'escape' }` (`installEscapeForwarder`).
 */
import { isReadOnlyProfile, type CloseRequestedReason } from '../protocol/types'

export { isReadOnlyProfile, type CloseRequestedReason }

const ESC_LOCAL_SELECTOR = '[role="dialog"], [role="menu"], [aria-modal="true"], [data-esc-local]'

function isInsideLocalEscScope(node: unknown): boolean {
  return (
    typeof node === 'object' &&
    node !== null &&
    'closest' in node &&
    typeof (node as Element).closest === 'function' &&
    (node as Element).closest(ESC_LOCAL_SELECTOR) !== null
  )
}

/**
 * Listens for `keydown` `Escape` on `target` in the bubble phase and calls `report('escape')`
 * after dispatch (`setTimeout(..., 0)`) only when `!event.defaultPrevented` (including later-registered
 * window bubble listeners) and no element inside `[role="dialog"]`, `[role="menu"]`,
 * `[aria-modal="true"]`, or `[data-esc-local]` held focus at keydown time. Returns an uninstall
 * function that also cancels any pending timer.
 */
export function installEscapeForwarder(
  target: Window,
  report: (reason: CloseRequestedReason) => void,
): () => void {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat
    )
      return
    const active = target.document?.activeElement ?? null
    if (isInsideLocalEscScope(active) || isInsideLocalEscScope(event.target)) return
    if (pendingTimer !== null) clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => {
      pendingTimer = null
      if (!event.defaultPrevented) report('escape')
    }, 0)
  }
  target.addEventListener('keydown', onKeyDown, false)
  return () => {
    target.removeEventListener('keydown', onKeyDown, false)
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }
}
