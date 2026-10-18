/**
 * Another aria-modal dialog (e.g. the S5 conflict dialog) is on screen and is
 * not an ancestor of `inside`: moving focus or opening a second modal now would
 * put keyboard and screen-reader users behind it.
 */
export function foreignModalOpen(inside?: Element | null): boolean {
  if (typeof document === 'undefined') return false
  for (const modal of document.querySelectorAll('[aria-modal="true"]')) {
    if (!inside || !modal.contains(inside)) return true
  }
  return false
}

/**
 * Runs `run` now when no foreign modal is open, otherwise once the last one
 * closes. Returns a cancel function that is safe to call after `run` has fired.
 */
export function whenNoForeignModal(run: () => void, inside?: Element | null): () => void {
  if (!foreignModalOpen(inside)) {
    run()
    return () => undefined
  }
  const observer = new MutationObserver(() => {
    if (foreignModalOpen(inside)) return
    observer.disconnect()
    run()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-modal'],
  })
  return () => observer.disconnect()
}

/**
 * Keeps Tab / Shift+Tab inside an inline alertdialog (the settings-page confirms
 * and notices that are not aria-modal): reaching the last stop wraps to the first
 * and vice versa. Focus that is not inside the root is pulled back in; nothing
 * runs for other keys or for a root without stops, and the handler only sees keys
 * pressed inside its own dialog, so a foreign modal keeps its focus untouched.
 */
export function wrapTabKey(event: {
  key: string
  shiftKey: boolean
  currentTarget: EventTarget | null
  preventDefault: () => void
}): void {
  if (event.key !== 'Tab' || typeof document === 'undefined') return
  const root = event.currentTarget
  if (!(root instanceof HTMLElement)) return
  const stops = Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'),
  ).filter((el) => el.tabIndex >= 0 && !('disabled' in el && el.disabled))
  if (stops.length === 0) return
  const first = stops[0]!
  const last = stops[stops.length - 1]!
  const active = document.activeElement
  if (!root.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (active === first && event.shiftKey) {
    event.preventDefault()
    last.focus()
  } else if (active === last && !event.shiftKey) {
    event.preventDefault()
    first.focus()
  }
}
