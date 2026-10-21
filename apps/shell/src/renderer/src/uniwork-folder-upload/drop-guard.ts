import { useEffect } from 'react'
import { claimDrag } from '../drag-claim'
import { dragHasFiles } from './drop'

/**
 * While the pre-flight or the report is open, the window is behind a modal: a
 * file dropped now must go nowhere. Home's window-level "Drop to open" overlay
 * and the preload drop bridge (which opens the dropped files) both live above
 * the dialog's React tree, so they would take the drop. This claims the drag
 * for the modal in the capture phase, before either sees it: the overlay skips
 * a claimed enter/leave, the bridge skips a cancelled drop, and the cursor
 * shows "not allowed" over the dialog. Drags without files are left alone.
 */
export function useModalDropGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const claim = (event: Event) => {
      const transfer = (event as DragEvent).dataTransfer
      if (!dragHasFiles(transfer)) return
      claimDrag(event)
      event.preventDefault()
      if (event.type === 'dragover' && transfer) transfer.dropEffect = 'none'
    }
    const events = ['dragenter', 'dragover', 'dragleave', 'drop'] as const
    for (const name of events) window.addEventListener(name, claim, true)
    return () => {
      for (const name of events) window.removeEventListener(name, claim, true)
    }
  }, [active])
}
