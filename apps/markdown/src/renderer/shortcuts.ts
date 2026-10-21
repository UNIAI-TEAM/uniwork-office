/**
 * The Markdown module's keyboard commands.
 *
 * Every chord comes from the `@genoffice/shortcuts` markdown table (UNI-2011):
 * the Microsoft Office key where Word has one, the module's own key otherwise.
 * Two layers read it through here: the window handler in App.tsx (file, find,
 * view and zoom commands) and the editor keymap (editor/tableKeymap.ts: text
 * and block commands). A command of one layer is never swallowed by the other:
 * the window handler leaves editor commands alone, so the editor still sees
 * Ctrl+Shift+S (strikethrough on Windows) and Shift+Cmd+X (strikethrough on
 * macOS). Open, Print and Close stay with the desktop menu / web host.
 */
import {
  ariaKeyshortcuts,
  createMatcher,
  currentShortcutPlatform,
  findShortcut,
  formatHint,
  markdownShortcuts,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { platform as capabilityPlatform } from './capabilities'

/** window-level commands: handled by App.tsx wherever the focus is */
export type MarkdownAppCommand =
  | 'save'
  | 'saveAs'
  | 'print'
  | 'find'
  | 'findNext'
  | 'replace'
  | 'toggleSource'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'

/** editor commands: handled by the editor keymap while the document has the focus */
export type MarkdownEditorCommand =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'paragraph'
  | 'bulletList'
  | 'orderedList'
  | 'link'
  | 'duplicateBlock'
  // history belongs to the editor that has the focus (ProseMirror, or CodeMirror in the source view)
  | 'undo'
  | 'redo'

export type MarkdownCommand = MarkdownAppCommand | MarkdownEditorCommand

/** table row (`shortcuts.csv` id) → command */
const COMMANDS: Readonly<Record<string, MarkdownCommand>> = {
  'markdown-002': 'save',
  'markdown-003': 'saveAs',
  'markdown-004': 'print',
  'markdown-006': 'undo',
  'markdown-007': 'redo',
  'markdown-013': 'find',
  'markdown-014': 'findNext',
  'markdown-015': 'replace',
  'markdown-016': 'bold',
  'markdown-017': 'italic',
  'markdown-019': 'strike',
  'markdown-021': 'toggleSource',
  'markdown-022': 'heading1',
  'markdown-023': 'heading2',
  'markdown-024': 'heading3',
  'markdown-025': 'paragraph',
  'markdown-026': 'bulletList',
  'markdown-027': 'orderedList',
  'markdown-029': 'link',
  'markdown-031': 'duplicateBlock',
  'markdown-033': 'zoomIn',
  'markdown-034': 'zoomOut',
  'markdown-035': 'zoomReset',
}

const APP_COMMANDS: ReadonlySet<MarkdownCommand> = new Set<MarkdownAppCommand>([
  'save',
  'saveAs',
  'print',
  'find',
  'findNext',
  'replace',
  'toggleSource',
  'zoomIn',
  'zoomOut',
  'zoomReset',
])

const ROWS: Readonly<Record<MarkdownCommand, string>> = Object.fromEntries(
  Object.entries(COMMANDS).map(([id, command]) => [command, id]),
) as Record<MarkdownCommand, string>

const matcher = createMatcher(markdownShortcuts)

/** the web frame runs with `platform: 'web'` capabilities; Electron leaves it unset */
export function markdownSurface(): ShortcutSurface {
  return capabilityPlatform() === 'web' ? 'web' : 'desktop'
}

/**
 * The command a keydown asks for, or null. IME composition, held repeats of a
 * one-shot command and AltGr never match (the shared matcher's guards).
 */
export function markdownShortcutCommand(
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = markdownSurface(),
): MarkdownCommand | null {
  const action = matcher(event, platform, surface)
  return action ? (COMMANDS[action.id] ?? null) : null
}

/**
 * The command the window handler claims (and preventDefault's) for a keydown, or
 * null: text and block keys, Ctrl+Shift+S strikethrough among them, are left to
 * the editor. Pure, so the handler's claims are testable without mounting the App.
 */
export function markdownWindowCommand(
  event: ShortcutKeyEvent,
  platform?: ShortcutPlatform,
  surface?: ShortcutSurface,
): MarkdownAppCommand | null {
  const command = markdownShortcutCommand(event, platform, surface)
  return command && isAppCommand(command) ? command : null
}

export function isAppCommand(command: MarkdownCommand): command is MarkdownAppCommand {
  return APP_COMMANDS.has(command)
}

export function isEditorCommand(command: MarkdownCommand): command is MarkdownEditorCommand {
  return !APP_COMMANDS.has(command)
}

/** `Ctrl+S` / `⌘S` for a command on this platform and surface; '' when it has none */
export function markdownHint(
  command: MarkdownCommand,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = markdownSurface(),
): string {
  const action = findShortcut('markdown', ROWS[command])
  return action ? formatHint(action, platform, surface) : ''
}

/** a trailing "(⌘S)" / "(Ctrl+S)" of a translated label: the old hand-written hint */
const TRAILING_HINT = /\s*[(（][^()（）]*(?:⌘|⌃|⌥|⇧|Ctrl|Cmd|Alt\b|Shift)[^()（）]*[)）]\s*$/

/** `aria-keyshortcuts` value (`Control+S`, `Meta+S`) for a command on this platform and surface; '' when it has none */
export function markdownAria(
  command: MarkdownCommand,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = markdownSurface(),
): string {
  const action = findShortcut('markdown', ROWS[command])
  return action ? ariaKeyshortcuts(action, platform, surface) : ''
}

/** an accessible name: the label without any hand-written hint, never a chord (that is `markdownAria`) */
export function markdownPlainLabel(label: string): string {
  return label.replace(TRAILING_HINT, '')
}

/** a tooltip: the label without any hand-written hint, then the table's chord */
export function withMarkdownHint(
  label: string,
  command: MarkdownCommand,
  platform?: ShortcutPlatform,
  surface?: ShortcutSurface,
): string {
  const bare = markdownPlainLabel(label)
  const hint = markdownHint(command, platform, surface)
  return hint ? `${bare} (${hint})` : bare
}
