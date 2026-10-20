/**
 * PDF keys come from the `@genoffice/shortcuts` pdf table (UNI-2011): the Edge
 * PDF viewer's chords plus our editor's own. The window keydown handler, the
 * margin-note / text-edit boxes and the tooltips read the same rows; the
 * matcher already refuses an IME composition (isComposing / keyCode 229), an
 * AltGr chord and any extra modifier.
 *
 * Bare keys (Enter, Esc, Space, arrows, Delete...) are not table rows: the
 * table's trace lock only accepts chords a CSV cell prints with a modifier. They
 * are matched here with the same guards (plain key, no composition).
 */
import {
  createMatcher,
  currentShortcutPlatform,
  findShortcut,
  formatHint,
  isComposingEvent,
  pdfShortcuts,
  type ShortcutAction,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { platform as hostPlatform } from './capabilities'

/** A DOM keydown or a React one (its `isComposing` lives on the native event). */
export type PdfKeyEvent = KeyboardEvent | { readonly nativeEvent: KeyboardEvent }

function nativeEvent(event: PdfKeyEvent): KeyboardEvent {
  return 'nativeEvent' in event ? event.nativeEvent : event
}

/** The web frame answers to the web column of the table, the desktop app to the desktop one. */
export function pdfSurface(): ShortcutSurface {
  return hostPlatform() === 'web' ? 'web' : 'desktop'
}

const matcher = createMatcher(pdfShortcuts)

/**
 * The table row a keydown triggers, or null. `context` selects a mode's keymap
 * (`note`: the margin-note box, `text-edit`: the in-place text editor); no
 * context is the window-level keymap.
 */
export function matchPdfKey(
  event: PdfKeyEvent,
  context?: string,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = pdfSurface(),
): ShortcutAction | null {
  return matcher(nativeEvent(event) as ShortcutKeyEvent, platform, surface, context)
}

/** What the window keydown handler does with a matched table chord. */
export interface PdfWindowKeyEffect {
  readonly action: ShortcutAction
  /** Save As is the shell menu's: the key must reach its accelerator, so no preventDefault. */
  readonly preventDefault: boolean
  /** Rotate (pdf-12): the angle to add to every page. */
  readonly rotate?: -90 | 90
}

/**
 * The window handler's decision for a keydown: the effect to run, or null when
 * the key is not ours. Ctrl+[ / Ctrl+] rotate only when the key prints `[` / `]`
 * (the table matches punctuation by position, and a German, Spanish or Italian
 * layout prints "+" on the physical BracketRight key: that is zoom, not rotate).
 * Fit toggle and rotate never run inside a text field; undo / redo stay with a
 * text field that has its own (`documentUndo` false).
 */
export function resolvePdfWindowKey(
  event: PdfKeyEvent,
  state: {
    readonly inEditable: boolean
    readonly documentUndo: boolean
    readonly platform?: ShortcutPlatform
    readonly surface?: ShortcutSurface
  },
): PdfWindowKeyEffect | null {
  const action = matchPdfKey(event, undefined, state.platform, state.surface)
  if (!action) return null
  if ((action.id === 'pdf-03' || action.id === 'pdf-04') && !state.documentUndo) return null
  if (state.inEditable && (action.id === 'pdf-11' || action.id === 'pdf-12')) return null
  if (action.id === 'pdf-12') {
    const key = nativeEvent(event).key
    if (key !== '[' && key !== ']') return null
    return { action, preventDefault: true, rotate: key === '[' ? -90 : 90 }
  }
  return { action, preventDefault: action.id !== 'pdf-02' }
}

/** `key` with no modifier held and no IME composition in progress. */
export function isPlainKey(event: PdfKeyEvent, key: string): boolean {
  const e = nativeEvent(event)
  return (
    e.key === key &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.shiftKey &&
    !e.metaKey &&
    !isComposingEvent(e as ShortcutKeyEvent)
  )
}

/** Enter confirms a dialog; not while an IME composition is being committed. */
export function isConfirmKey(event: PdfKeyEvent): boolean {
  return isPlainKey(event, 'Enter')
}

/** Esc cancels a dialog or overlay; not while an IME composition is being cancelled. */
export function isCancelKey(event: PdfKeyEvent): boolean {
  return isPlainKey(event, 'Escape')
}

/** Enter (next) / Shift+Enter (previous) in the search box; null for any other key or an IME Enter. */
export function searchEnterDirection(event: PdfKeyEvent): 1 | -1 | null {
  const e = nativeEvent(event)
  if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey) return null
  if (isComposingEvent(e as ShortcutKeyEvent)) return null
  return e.shiftKey ? -1 : 1
}

/** The primary chord of a table row as this platform shows it (`Ctrl+Y`, `⌘F`), or '' without one. */
export function pdfHint(
  id: string,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = pdfSurface(),
): string {
  const action = findShortcut('pdf', id)
  if (!action) throw new Error(`no pdf shortcut row ${id}`)
  return formatHint(action, platform, surface)
}

/** A tooltip label with the row's primary key appended: `Redo (Ctrl+Y)`; the bare label without one. */
export function pdfTip(
  label: string,
  id: string,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = pdfSurface(),
): string {
  const hint = pdfHint(id, platform, surface)
  return hint ? `${label} (${hint})` : label
}
