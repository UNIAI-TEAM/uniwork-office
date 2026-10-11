/**
 * Ctrl+W (Cmd+W on macOS) as a keyboard event, for the shell window's
 * webContents that must close the active tab on it without waiting for the
 * application menu accelerator. The accelerator only fires once Chromium
 * forwards the page's unhandled key to the window, and keyboard focus is not
 * always where the user looks: the hidden spare sheets view mounted after a
 * workbook opened can hold it, so the chord did nothing until a click in the grid.
 */

export interface CloseTabChordInput {
  type: string
  key: string
  /** physical key: still KeyW under a non-Latin layout, where `key` is another letter */
  code?: string
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
  return input.key.toLowerCase() === 'w' || input.code === 'KeyW'
}
