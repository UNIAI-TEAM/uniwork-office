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
  ariaKeyshortcuts,
  createMatcher,
  currentShortcutPlatform,
  findShortcut,
  formatHint,
  htmlShortcuts,
  chordsFor,
  matchShortcut,
  parseChord,
  toElectronAccelerator,
  type ShortcutAction,
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

/** `aria-keyshortcuts` value (`Control+S`, `Meta+S`) for a command on this platform and surface; '' when it has none */
export function htmlAria(
  command: HtmlShortcutCommand,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = htmlSurface(),
): string {
  const action = findShortcut('html', ROWS[command])
  return action ? ariaKeyshortcuts(action, platform, surface) : ''
}

/** an accessible name: the label without any hand-written hint, never a chord (that is `htmlAria`) */
export function htmlPlainLabel(label: string): string {
  return label.replace(TRAILING_HINT, '')
}

/** a tooltip: the label without any hand-written hint, then the table's chord */
export function withHtmlHint(
  label: string,
  command: HtmlShortcutCommand,
  platform?: ShortcutPlatform,
  surface?: ShortcutSurface,
): string {
  const bare = htmlPlainLabel(label)
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
 * Whether this key is the chord the desktop File menu turns into the Save / Save As accelerator
 * (the row's first chord on the platform). Electron runs that accelerator itself for a key the
 * frame leaves unhandled, so replaying it too would save twice (two Save As dialogs). An alias
 * without an accelerator (Ctrl+Shift+S) is not the menu's and still needs the replay.
 */
function isMenuAccelerator(
  event: KeyboardEvent,
  command: HtmlShortcutCommand | null,
  platform: ShortcutPlatform,
  surface: ShortcutSurface,
): boolean {
  if (surface !== 'desktop' || (command !== 'save' && command !== 'saveAs')) return false
  const action = findShortcut('html', ROWS[command])
  if (!action || !toElectronAccelerator(action, platform)) return false
  const primary: ShortcutAction = { ...action, [platform]: action[platform].slice(0, 1) }
  return !!matchShortcut(event, [primary], platform, surface)
}

/**
 * A key relayed from the Preview frame, as the keydown to replay on the host window, or null when
 * the table has no app-level command for it. The frame's keydown never reaches the window; the
 * replay does, so the ribbon's collapse listener and the window handler run with their own
 * guards (IME, AltGr, repeat) unchanged. The frame is untrusted, hence the whitelist: a page
 * script can forge a relay message, and bold / link / undo keys have their own checked path.
 * Desktop leaves the File menu's own Save / Save As accelerator to the menu (see above).
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
  if (isMenuAccelerator(event, command, platform, surface)) return null
  const collapse = !!COLLAPSE_ACTION && matchShortcut(event, [COLLAPSE_ACTION], platform, surface)
  return (command && FRAME_REPLAYED.has(command)) || collapse ? event : null
}

/**
 * shortest time between two replays of Save / Save As (the commands that open a dialog); a page
 * script can forge the relay message. Find next, find and view cycling are not limited: a person
 * taps them faster than this, and the host's own window handler has no limit either.
 */
const REPLAY_MIN_GAP_MS = 250

/**
 * Whether the host window has transient user activation (a real key or click in the last few
 * seconds). A key typed inside the cross-origin preview frame counts: HTML Standard, "activation
 * notification steps" (user activation processing model): on an activation triggering input event
 * ("keydown" that is trusted, not Esc and not a user-agent reserved shortcut) the user agent sets
 * the last activation timestamp of the document's window AND "the active window of each of
 * document's ancestor navigables", with no origin check (only descendants are filtered by origin).
 * Chromium and Electron implement this, so the host window is active for every key a person types in
 * the frame, while a page script firing on a timer gets none. A missing API (jsdom, old engines) is
 * treated as active.
 */
export function hostHasUserActivation(): boolean {
  return (
    (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
      ?.isActive !== false
  )
}

/**
 * The host side of the relay: `htmlFrameKeyReplay` behind the checks a real keystroke passes and a
 * forged message does not. The keystroke put focus on the iframe element and gave the host window
 * transient user activation, so a page script can neither drive a command while the user is
 * elsewhere nor on a timer while they read; Save / Save As are dropped while a save is running and
 * replay at most once per `REPLAY_MIN_GAP_MS`.
 */
export function createHtmlFrameKeyReplay() {
  let lastDialogAt: number | undefined
  return (
    relayed: Parameters<typeof htmlFrameKeyReplay>[0],
    ctx: {
      frameFocused: boolean
      userActive: boolean
      saving: boolean
      now?: number
      platform?: ShortcutPlatform
      surface?: ShortcutSurface
    },
  ): KeyboardEvent | null => {
    if (!ctx.frameFocused || !ctx.userActive) return null
    const event = htmlFrameKeyReplay(relayed, ctx.platform, ctx.surface)
    if (!event) return null
    const command = htmlShortcutCommand(event, ctx.platform, ctx.surface) ?? 'collapse'
    if (command !== 'save' && command !== 'saveAs') return event
    if (ctx.saving) return null
    const now = ctx.now ?? Date.now()
    if (lastDialogAt !== undefined && now - lastDialogAt < REPLAY_MIN_GAP_MS) return null
    lastDialogAt = now
    return event
  }
}

/** a chord the frame lets the browser handle by default unless told otherwise */
export interface HtmlFrameKeyClaim {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * The chords the host replays for a key pressed in the frame, for the frame to `preventDefault`
 * (the browser's find bar, Save page and history must not also run). Web only: on desktop the
 * File menu's accelerators run after an unhandled key, so claiming there would swallow them.
 * Letters, F-keys and the backslash are the only keys the replayed rows use on web.
 */
export function htmlFrameKeyClaims(
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = htmlSurface(),
): HtmlFrameKeyClaim[] {
  if (surface !== 'web') return []
  const rows = [...FRAME_REPLAYED].map((command) => findShortcut('html', ROWS[command]))
  const claims: HtmlFrameKeyClaim[] = []
  for (const action of [...rows, COLLAPSE_ACTION]) {
    if (!action) continue
    for (const chord of chordsFor(action, platform, surface)) {
      const parsed = parseChord(chord)
      const key = parsed?.key === 'Backslash' ? '\\' : parsed?.key.toLowerCase()
      if (!parsed || !key || !/^([a-z]|f\d{1,2}|\\)$/.test(key)) continue
      claims.push({
        key,
        ctrlKey: parsed.ctrl,
        altKey: parsed.alt,
        shiftKey: parsed.shift,
        metaKey: parsed.cmd,
      })
    }
  }
  return claims
}
