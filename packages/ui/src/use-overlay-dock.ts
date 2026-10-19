/**
 * Keyboard and focus behavior of the AI dock while it overlays the document (UNI-1987).
 *
 * Below `OVERLAY_DOCK_MAX_PX` the dock leaves the row and floats over the document (ai-dock-narrow.css),
 * so it behaves like a modal sheet: opening moves focus into the composer, Esc closes it, Tab stays
 * inside it and closing hands focus back to the control that opened it. CSS cannot do any of that, so
 * the five AiPanel mounts and the Sheets chat panel call this hook. Above the breakpoint the dock is a
 * plain side panel and the hook changes nothing (no role, no focus moves, Esc is left alone).
 */
import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { isComposerPopupOpen } from './ai-uniwork-composer'
import { focusableIn, trapTab } from './modal-keys'

/** the widest viewport where the dock overlays the document (keep in step with ai-dock-narrow.css) */
export const OVERLAY_DOCK_MAX_PX = 900

export const overlayDockQuery = (maxPx: number = OVERLAY_DOCK_MAX_PX): string =>
  `(max-width: ${maxPx}px)`

/** the expand control of a collapsed dock (Sheets draws its own) */
const RAIL = '.ai-rail, .expand-copilot'

/** the dock element of a panel node: Sheets' panel is its own dock, the other apps wrap it in `.ai-dock` */
export function findDock(node: Element | null): HTMLElement | null {
  if (!node) return null
  return (node.closest('.ai-dock') as HTMLElement | null) ?? (node as HTMLElement)
}

/**
 * Esc closes the overlaid dock unless somebody else already used the key: a running request that the
 * composer cancelled, a composer popup that closed itself, or an IME composition.
 */
export function shouldCloseOnEscape(e: {
  key: string
  defaultPrevented: boolean
  isComposing?: boolean
  targetInDock: boolean
  popupOpen: boolean
}): boolean {
  return (
    e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && e.targetInDock && !e.popupOpen
  )
}

/**
 * Opening moves focus to the composer, except when something that asked for the panel already holds
 * a text field outside the dock (a selection popover's own input) or focus is already inside the dock.
 */
export function shouldFocusComposer(active: { inDock: boolean; isTextField: boolean }): boolean {
  return !active.inDock && !active.isTextField
}

const isTextField = (el: Element | null): boolean =>
  !!el &&
  (el.tagName === 'TEXTAREA' ||
    el.tagName === 'INPUT' ||
    (el as HTMLElement).isContentEditable === true)

function useMediaMatch(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      let mql: MediaQueryList | null = null
      try {
        mql = window.matchMedia(query)
      } catch {
        return () => {}
      }
      mql.addEventListener('change', notify)
      return () => mql!.removeEventListener('change', notify)
    },
    () => {
      try {
        return window.matchMedia(query).matches
      } catch {
        return false
      }
    },
    () => false,
  )
}

export interface OverlayDockOptions {
  /** the panel's root element (its closest `.ai-dock` is the dialog; Sheets' panel is its own dock) */
  rootRef: RefObject<HTMLElement | null>
  /** the panel is expanded */
  open: boolean
  /** collapse the panel (Esc) */
  onClose: () => void
  /** the panel's visible title: names the dialog */
  label: string
  /** the dock overlays at this viewport width and below (default 900; Sheets keeps its own 719) */
  maxWidthPx?: number
}

/** returns whether the dock currently overlays the document */
export function useOverlayDock({
  rootRef,
  open,
  onClose,
  label,
  maxWidthPx = OVERLAY_DOCK_MAX_PX,
}: OverlayDockOptions): boolean {
  const overlaid = useMediaMatch(overlayDockQuery(maxWidthPx))
  const onCloseRef = useRef(onClose)
  const labelRef = useRef(label)
  useEffect(() => {
    onCloseRef.current = onClose
    labelRef.current = label
  })
  /** the last focused element outside the open panel (the rail included): the opener to hand focus back to */
  const lastOutsideRef = useRef<HTMLElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const dockRef = useRef<HTMLElement | null>(null)
  const wasOverlaidOpenRef = useRef(false)
  const active = open && overlaid

  useEffect(() => {
    if (!overlaid) return
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null
      if (!target || target === document.body || rootRef.current?.contains(target)) return
      lastOutsideRef.current = target
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [overlaid, rootRef])

  useEffect(() => {
    if (!active) return
    const dock = findDock(rootRef.current)
    if (!dock) return
    dockRef.current = dock
    // the rail that was pressed is gone by now (the panel replaced it): closing then lands on the new rail
    const last = lastOutsideRef.current
    openerRef.current = last?.isConnected ? last : null

    // the dialog semantics live on the overlay only: removed again on close and above the breakpoint
    dock.setAttribute('role', 'dialog')
    dock.setAttribute('aria-modal', 'true')
    dock.setAttribute('aria-label', labelRef.current)

    // focus the composer once it exists (Slides mounts the panel lazily, the dock animates open)
    let frame = 0
    let tries = 0
    const focusComposer = () => {
      const now = document.activeElement
      if (
        !shouldFocusComposer({
          inDock: !!now && now !== document.body && dock.contains(now),
          isTextField: !!now && !dock.contains(now) && isTextField(now),
        })
      ) {
        return
      }
      const ta =
        dock.querySelector<HTMLTextAreaElement>('.ai-input-box textarea') ??
        dock.querySelector<HTMLTextAreaElement>('textarea')
      if (ta && !ta.disabled) {
        ta.focus({ preventScroll: true })
        if (document.activeElement === ta) return
      }
      if (tries++ < 60) frame = requestAnimationFrame(focusComposer)
    }
    focusComposer()

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as Element | null
      const inDock = !!target && dock.contains(target)
      if (e.key === 'Escape') {
        if (
          shouldCloseOnEscape({
            key: e.key,
            defaultPrevented: e.defaultPrevented,
            isComposing: e.isComposing,
            // focus parked on the page body (a click on blank dock space) still belongs to the dock
            targetInDock: inDock || target === document.body || target === null,
            popupOpen: isComposerPopupOpen(dock),
          })
        ) {
          e.preventDefault()
          onCloseRef.current()
        }
        return
      }
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return
      if (inDock) {
        trapTab(dock, e)
      } else if (target === document.body || target === null) {
        // focus fell to the body: re-enter the dock instead of walking into the covered document
        const items = focusableIn(dock)
        const next = e.shiftKey ? items[items.length - 1] : items[0]
        if (next) {
          e.preventDefault()
          next.focus({ preventScroll: true })
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      dock.removeAttribute('role')
      dock.removeAttribute('aria-modal')
      dock.removeAttribute('aria-label')
    }
  }, [active, rootRef])

  // the title can change language while the dock is open
  useEffect(() => {
    if (active) dockRef.current?.setAttribute('aria-label', label)
  }, [active, label])

  // closing the overlay (Esc, the close button) hands focus back; crossing the breakpoint does not
  useEffect(() => {
    const was = wasOverlaidOpenRef.current
    wasOverlaidOpenRef.current = active
    if (!was || active || !overlaid) return
    const dock = dockRef.current
    if (!dock?.isConnected) return
    const now = document.activeElement
    // the user moved focus elsewhere on purpose: leave it
    if (now && now !== document.body && !dock.contains(now)) return
    const opener = openerRef.current
    const target =
      opener && opener.isConnected && !dock.contains(opener)
        ? opener
        : dock.querySelector<HTMLElement>(RAIL)
    target?.focus({ preventScroll: true })
  }, [active, overlaid])

  return overlaid
}
