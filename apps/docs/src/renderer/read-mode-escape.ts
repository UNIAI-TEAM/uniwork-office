/** an open modal (Print, page setup, ...) or a surface that handles its own Esc */
const OPEN_DIALOG = '.modal-backdrop, [role="dialog"], [aria-modal="true"]'

/**
 * Read Mode: Esc leaves it. Window capture phase, so the listener runs (and calls preventDefault)
 * before the web frame's bubble-phase Escape forwarder looks at `defaultPrevented`. Capture also
 * runs ahead of a dialog's own window-capture Esc handler, so an Esc that belongs to an open
 * dialog or a `[data-esc-local]` surface is left alone: it closes only that surface.
 */
export function installReadModeEscape(onLeave: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    if (document.querySelector(OPEN_DIALOG)) return
    if (e.target instanceof Element && e.target.closest('[data-esc-local]')) return
    e.preventDefault()
    onLeave()
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
