import {
  ariaKeyshortcuts,
  currentShortcutPlatform,
  findShortcut,
  formatHint,
} from '@genoffice/shortcuts'

/** The table chord of a Home control for a platform (`Ctrl+O`, `⌘O`), or an empty
 * string when the row has no chord there or does not exist. */
export function shortcutHint(id: string, platform = currentShortcutPlatform()): string {
  const action = findShortcut('common', id)
  return action ? formatHint(action, platform, 'desktop') : ''
}

/** The same chord for `aria-keyshortcuts` (`Control+O`, `Meta+O`), or an empty string. The
 * control's accessible name stays its plain label: the chord goes here and in the tooltip only. */
export function shortcutAria(id: string, platform = currentShortcutPlatform()): string {
  const action = findShortcut('common', id)
  return action ? ariaKeyshortcuts(action, platform, 'desktop') : ''
}

/** Tooltip text for a Home control: `label (Ctrl+N)`, or the bare label when the
 * table gives the action no chord on this platform. */
export function withShortcutHint(label: string, id: string, platform = currentShortcutPlatform()) {
  const hint = shortcutHint(id, platform)
  return hint ? `${label} (${hint})` : label
}
