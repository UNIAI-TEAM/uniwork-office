// Placement of the row "…" popups. A module of its own with no imports, so the browser e2e
// (e2e/home-row-menu-layout.spec.ts) can run the production function against real layout.

/** gap between the "…" button and its popup, and the least distance the popup keeps from the window edge */
const MENU_GAP = 4
const MENU_EDGE = 8

/**
 * The popup is portalled to the body and placed with fixed coordinates, so no
 * scrollable list or clipped dialog can cut it off. It drops below the button
 * and flips upward when the room below is smaller than it is (and larger above).
 */
export function placeMenu(button: HTMLElement, menu: HTMLElement) {
  const anchor = button.getBoundingClientRect()
  const { width, height } = menu.getBoundingClientRect()
  const below = window.innerHeight - anchor.bottom - MENU_GAP - MENU_EDGE
  const above = anchor.top - MENU_GAP - MENU_EDGE
  const up = height > below && above > below
  const top = up ? anchor.top - MENU_GAP - height : anchor.bottom + MENU_GAP
  const left = Math.max(MENU_EDGE, anchor.right - width)
  menu.style.top = `${Math.max(MENU_EDGE, top)}px`
  menu.style.left = `${left}px`
  menu.dataset.placement = up ? 'up' : 'down'
}
