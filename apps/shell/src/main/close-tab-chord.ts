/**
 * Ctrl+W (Cmd+W on macOS) as a keyboard event, for the tab views that must close
 * on it without waiting for the application menu accelerator. The accelerator
 * only fires once Chromium forwards the page's unhandled key to the window; a
 * sheets view that was mounted ahead of the open (the spare view) has not
 * taken keyboard focus yet, so the chord did nothing until a click in the grid.
 */

export interface CloseTabChordInput {
  type: string
  key: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  isAutoRepeat?: boolean
}

export function isCloseTabChord(input: CloseTabChordInput): boolean {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false
  if (input.alt || input.shift) return false
  // either modifier, like the menu's CmdOrCtrl; exactly one so Ctrl+Cmd+W stays free
  if (input.control === input.meta) return false
  return input.key.toLowerCase() === 'w'
}
