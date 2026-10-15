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
