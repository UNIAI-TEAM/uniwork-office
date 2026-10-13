/**
 * Below 640 px the Discussion panel covers the editor instead of narrowing it (discussion.css).
 * What lies under the panel must not take clicks, focus or screen-reader attention, so the editor
 * root is `inert` + `aria-hidden` while the panel is open at that width and restored on close,
 * on a viewport resize, and on dispose. The document bar (toggle) is outside the editor root.
 */

/** the complement of discussion.css `@media (min-width: 640px)` */
export const NARROW_QUERY = '(max-width: 639.98px)'

export interface EditorShield {
  /** the panel opened / closed */
  setOpen(open: boolean): void
  /** drop the listener and give the editor back */
  dispose(): void
}

export function createEditorShield(doc: Document, rootSelector = '#root'): EditorShield {
  const media = doc.defaultView?.matchMedia?.(NARROW_QUERY)
  let open = false
  let shielded: HTMLElement | null = null
  let hadAriaHidden: string | null = null

  const release = () => {
    if (!shielded) return
    shielded.removeAttribute('inert')
    if (hadAriaHidden === null) shielded.removeAttribute('aria-hidden')
    else shielded.setAttribute('aria-hidden', hadAriaHidden)
    shielded = null
  }
  const apply = () => {
    if (!(open && media?.matches)) return release()
    const root = doc.querySelector<HTMLElement>(rootSelector)
    if (!root || root === shielded) return
    release()
    hadAriaHidden = root.getAttribute('aria-hidden')
    root.setAttribute('inert', '')
    root.setAttribute('aria-hidden', 'true')
    shielded = root
  }

  media?.addEventListener('change', apply)
  return {
    setOpen(next) {
      open = next
      apply()
    },
    dispose() {
      media?.removeEventListener('change', apply)
      open = false
      release()
    },
  }
}
