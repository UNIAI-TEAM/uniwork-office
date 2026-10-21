/**
 * The HTML module's keyboard commands.
 *
 * Every chord comes from the `@genoffice/shortcuts` html table (UNI-2011): the
 * Microsoft Office key where Word has one, the module's own key otherwise. The
 * window handler in App.tsx, the preview frame's relay and the ribbon tooltips
 * all read the table through here, so a key changes in one place. Open, Print
 * and Close stay with the desktop menu / web host and are not handled here.
 */
import {
  createMatcher,
  currentShortcutPlatform,
  findShortcut,
  formatHint,
  htmlShortcuts,
  matchShortcut,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { platform as capabilityPlatform } from './capabilities'

export type HtmlShortcutCommand =
  | 'save'
  | 'saveAs'
  | 'undo'
  | 'redo'
  | 'find'
  | 'findNext'
  | 'replace'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'link'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'cycleView'

/** table row (`shortcuts.csv` id) → what App.tsx does */
const COMMANDS: Readonly<Record<string, HtmlShortcutCommand>> = {
  'html-002': 'save',
  'html-003': 'saveAs',
  'html-006': 'undo',
  'html-007': 'redo',
  'html-012': 'find',
  'html-013': 'findNext',
  'html-014': 'replace',
  'html-015': 'bold',
  'html-016': 'italic',
  'html-017': 'underline',
  'html-018': 'link',
  'html-019': 'zoomIn',
  'html-020': 'zoomOut',
  'html-021': 'zoomReset',
  'html-025': 'cycleView',
}

/** the command row ids, for tooltips: `htmlHint('save')` */
const ROWS: Readonly<Record<HtmlShortcutCommand, string>> = Object.fromEntries(
  Object.entries(COMMANDS).map(([id, command]) => [command, id]),
) as Record<HtmlShortcutCommand, string>

const matcher = createMatcher(htmlShortcuts)

/** the web frame runs with `platform: 'web'` capabilities; Electron leaves it unset */
export function htmlSurface(): ShortcutSurface {
  return capabilityPlatform() === 'web' ? 'web' : 'desktop'
}

/**
 * The command a keydown asks for, or null. IME composition, held repeats of a
 * one-shot command and AltGr never match (the shared matcher's guards).
 */
export function htmlShortcutCommand(
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = htmlSurface(),
): HtmlShortcutCommand | null {
  const action = matcher(event, platform, surface)
  return action ? (COMMANDS[action.id] ?? null) : null
}

/** commands a focused text field (CodeMirror, an input) keeps for itself; Ctrl+U is CodeMirror's undoSelection */
const FIELD_KEEPS: ReadonlySet<HtmlShortcutCommand> = new Set([
  'bold',
  'italic',
  'underline',
  'link',
  'undo',
  'redo',
])

/**
 * What the window handler does with a keydown: the command it claims (and
 * preventDefault's), or null when the key is not ours or the focused text field
 * keeps it. Pure, so the handler's claims are testable without mounting the App.
 */
export function htmlWindowCommand(
  event: ShortcutKeyEvent,
  inTextField: boolean,
  platform?: ShortcutPlatform,
  surface?: ShortcutSurface,
): HtmlShortcutCommand | null {
  const command = htmlShortcutCommand(event, platform, surface)
  if (!command || (inTextField && FIELD_KEEPS.has(command))) return null
  return command
}

/** `Ctrl+S` / `⌘S` for a command on this platform and surface; '' when it has none */
export function htmlHint(
  command: HtmlShortcutCommand,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = htmlSurface(),
): string {
  const action = findShortcut('html', ROWS[command])
  return action ? formatHint(action, platform, surface) : ''
}

/** a trailing "(⌘S)" / "(Ctrl+S)" of a translated label: the old hand-written hint */
const TRAILING_HINT = /\s*[(（][^()（）]*(?:⌘|⌃|⌥|⇧|Ctrl|Cmd|Alt\b|Shift)[^()（）]*[)）]\s*$/

/** a tooltip: the label without any hand-written hint, then the table's chord */
export function withHtmlHint(
  label: string,
  command: HtmlShortcutCommand,
  platform?: ShortcutPlatform,
  surface?: ShortcutSurface,
): string {
  const bare = label.replace(TRAILING_HINT, '')
  const hint = htmlHint(command, platform, surface)
  return hint ? `${bare} (${hint})` : bare
}

/** commands a key pressed inside the Preview frame is replayed for: the app-level ones the frame cannot reach */
const FRAME_REPLAYED: ReadonlySet<HtmlShortcutCommand> = new Set([
  'save',
  'saveAs',
  'find',
  'findNext',
  'replace',
  'cycleView',
])

/** the ribbon collapse row (the shared hook matches this same action on window keydown) */
const COLLAPSE_ACTION = findShortcut('html', 'html-023')

/**
 * A key relayed from the Preview frame, as the keydown to replay on the host window, or null when
 * the table has no app-level command for it. The frame's keydown never reaches the window; the
 * replay does, so the ribbon's collapse listener and the window handler run with their own
 * guards (IME, AltGr, repeat) unchanged. The frame is untrusted, hence the whitelist: a page
 * script can forge a relay message, and bold / link / undo keys have their own checked path.
 */
export function htmlFrameKeyReplay(
  relayed: {
    key: string
    code: string
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
    metaKey: boolean
    altGraph: boolean
    repeat: boolean
    composing: boolean
  },
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = htmlSurface(),
): KeyboardEvent | null {
  const event = new KeyboardEvent('keydown', {
    key: relayed.key,
    code: relayed.code,
    ctrlKey: relayed.ctrlKey,
    altKey: relayed.altKey,
    shiftKey: relayed.shiftKey,
    metaKey: relayed.metaKey,
    modifierAltGraph: relayed.altGraph,
    repeat: relayed.repeat,
    isComposing: relayed.composing,
    bubbles: true,
    cancelable: true,
  })
  const command = htmlShortcutCommand(event, platform, surface)
  const collapse = !!COLLAPSE_ACTION && matchShortcut(event, [COLLAPSE_ACTION], platform, surface)
  return (command && FRAME_REPLAYED.has(command)) || collapse ? event : null
}
