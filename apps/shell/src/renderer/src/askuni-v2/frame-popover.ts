import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Closes a popover on a click outside it (the anchor and an open confirmation count as inside) and on Escape
 * pressed inside it, then hands focus back to the anchor unless the reader moved it elsewhere.
 */
export function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  anchorRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
): void {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const pop = popRef.current
    const anchor = anchorRef.current
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (pop?.contains(t) || anchor?.contains(t)) return
      if (t instanceof Element && t.closest('.wb-confirm')) return
      closeRef.current()
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      const now = document.activeElement
      if (!now || now === document.body || pop?.contains(now)) anchor?.focus()
    }
  }, [open, anchorRef, popRef])
}
