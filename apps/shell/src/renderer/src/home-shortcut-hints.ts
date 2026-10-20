import { currentShortcutPlatform, findShortcut, formatHint } from '@genoffice/shortcuts'

/** Tooltip text for a Home control: `label (Ctrl+N)`, or the bare label when the
 * table gives the action no chord on this platform. */
export function withShortcutHint(label: string, id: string, platform = currentShortcutPlatform()) {
  const action = findShortcut('common', id)
  const hint = action ? formatHint(action, platform, 'desktop') : ''
  return hint ? `${label} (${hint})` : label
}
