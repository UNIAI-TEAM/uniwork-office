/**
 * A reveal selects the commented cell and focuses the thread heading. Univer's hidden cell editor
 * then takes focus back 100-250 ms later (DocSelectionRenderService.activate, driven by the
 * selection change) and the heading loses it. This is a timing-based workaround, not a fix of
 * that refocus: for a short window after the reveal, focus that lands in the sheet container goes
 * back to the thread heading, unless the user has acted since.
 */
const GUARD_MS = 1500
const USER_INPUT = ['pointerdown', 'keydown', 'wheel'] as const

/** returns the cancel function; call it on unmount and before the next guard */
export function guardRevealFocus(threadId: string): () => void {
  const heading = (): HTMLElement | null => {
    const item = [...document.querySelectorAll<HTMLElement>('[data-thread-id]')].find(
      (node) => node.dataset.threadId === threadId,
    )
    return item?.querySelector<HTMLElement>('[data-thread-heading]') ?? null
  }
  const onFocusIn = (e: FocusEvent): void => {
    const target = e.target
    if (!(target instanceof Element) || !target.closest('#univer-container')) return
    heading()?.focus()
  }
  const cancel = (): void => {
    clearTimeout(timer)
    document.removeEventListener('focusin', onFocusIn, true)
    for (const type of USER_INPUT) document.removeEventListener(type, cancel, true)
  }
  const timer = setTimeout(cancel, GUARD_MS)
  document.addEventListener('focusin', onFocusIn, true)
  for (const type of USER_INPUT) document.addEventListener(type, cancel, true)
  return cancel
}
