/**
 * PDF keys come from the `@genoffice/shortcuts` pdf table (UNI-2011): the Edge
 * PDF viewer's chords plus our editor's own. The window keydown handler, the
 * margin-note / text-edit boxes and the tooltips read the same rows; the
 * matcher already refuses an IME composition (isComposing / keyCode 229), an
 * AltGr chord and any extra modifier.
 *
 * Bare keys (Enter, Esc, Space, arrows, Delete...) are table rows too, each in the
 * `context` of the surface that owns it (`dialog`, `ask`, `page-box`, `overlay`,
 * `selection`, `nav`, `note`, `text-edit`), so they never shadow the window-level
 * keymap. They go through the same matcher: no modifier, no IME composition.
 */
import {
  ariaKeyshortcuts,
  chordsFor,
  createMatcher,
  currentShortcutPlatform,
  findShortcut,
  formatAriaChords,
  formatChord,
  formatHint,
  parseChord,
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

/**
 * True when the keydown is `key` and the table has a chord for it in `context`
 * (a plain key: any modifier or an IME composition fails the match).
 */
export function isContextKey(event: PdfKeyEvent, context: string, key: string): boolean {
  return nativeEvent(event).key === key && matchPdfKey(event, context) !== null
}

/** Enter confirms (`dialog` by default; `ask`: the Ask-AI box, `page-box`: the page number); not mid-composition. */
export function isConfirmKey(event: PdfKeyEvent, context = 'dialog'): boolean {
  return isContextKey(event, context, 'Enter')
}

/** Esc cancels a dialog or overlay (`dialog` by default, `note`, `text-edit`, `ask`, `overlay`); not mid-composition. */
export function isCancelKey(event: PdfKeyEvent, context = 'dialog'): boolean {
  return isContextKey(event, context, 'Escape')
}

/**
 * Ctrl+Enter (Cmd+Enter on a Mac) commits a margin note or an in-place text edit.
 * Those rows (`pdf-21`, `pdf-24`) also hold Esc, Backspace and Delete, so the row
 * id says nothing about which key was pressed: test the key, then the table.
 */
export function isCommitKey(
  event: PdfKeyEvent,
  context: string,
  platform?: ShortcutPlatform,
  surface?: ShortcutSurface,
): boolean {
  const e = nativeEvent(event)
  return (
    (e.ctrlKey || e.metaKey) &&
    e.key === 'Enter' &&
    matchPdfKey(event, context, platform, surface) !== null
  )
}

/** What a keydown in the in-place text editor asks for. */
export type TextEditKeyAction = 'commit' | 'cancel' | 'delete-run'

/**
 * The in-place text editor's reaction to a keydown: Ctrl/Cmd+Enter commits, Esc
 * cancels, Backspace / Delete on an already empty draft removes the run. Any other
 * key (a Backspace in a non-empty draft included) is the textarea's own: null.
 */
export function textEditKeyAction(
  event: PdfKeyEvent,
  draftEmpty: boolean,
): TextEditKeyAction | null {
  if (isCommitKey(event, 'text-edit')) return 'commit'
  if (isCancelKey(event, 'text-edit')) return 'cancel'
  if (
    draftEmpty &&
    (isContextKey(event, 'text-edit', 'Backspace') || isContextKey(event, 'text-edit', 'Delete'))
  ) {
    return 'delete-run'
  }
  return null
}

/** The React keydown event of the in-place text editor's textarea. */
export interface TextEditKeyEvent {
  readonly nativeEvent: KeyboardEvent
  preventDefault(): void
  stopPropagation(): void
}

/**
 * The in-place text editor textarea's `onKeyDown`: runs the action `textEditKeyAction`
 * reads off the key and claims the event for it; any other key stays the textarea's own.
 */
export function onTextEditKeyDown(
  event: TextEditKeyEvent,
  draftEmpty: boolean,
  handlers: { commit(): void; cancel(): void; deleteRun(): void },
): void {
  const action = textEditKeyAction(event, draftEmpty)
  if (!action) return
  event.preventDefault()
  // Esc must not also close the overlay behind the editor
  if (action === 'cancel') event.stopPropagation()
  if (action === 'commit') handlers.commit()
  else if (action === 'cancel') handlers.cancel()
  else handlers.deleteRun()
}

/** Enter (next) / Shift+Enter (previous) in the search box; null for any other key or an IME Enter. */
export function searchEnterDirection(event: PdfKeyEvent): 1 | -1 | null {
  const e = nativeEvent(event)
  if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey) return null
  if (isComposingEvent(e as ShortcutKeyEvent)) return null
  return e.shiftKey ? -1 : 1
}

/** The ribbon collapse key (common-10: Ctrl+F1 / Alt+Cmd+R; no key in a browser frame) for `useRibbonCollapse`. */
export function pdfRibbonCollapseOptions(
  platform?: ShortcutPlatform,
  surface: ShortcutSurface = pdfSurface(),
): {
  readonly action: ShortcutAction
  readonly surface: ShortcutSurface
  readonly platform?: ShortcutPlatform
} {
  const action = findShortcut('common', 'common-10')
  if (!action) throw new Error('no common shortcut row common-10')
  return platform ? { action, surface, platform } : { action, surface }
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

/**
 * The Previous-match button's tooltip: `pdf-06` lists Next first (Ctrl+G, F3) and
 * Previous second (Ctrl+Shift+G, Shift+F3), so the label takes the second chord.
 */
export function pdfPrevMatchTip(
  label: string,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = pdfSurface(),
): string {
  const action = findShortcut('pdf', 'pdf-06')
  if (!action) throw new Error('no pdf shortcut row pdf-06')
  const chord = chordsFor(action, platform, surface)[1]
  return chord ? `${label} (${formatChord(chord, platform)})` : label
}

/** `aria-keyshortcuts` value (`Control+Y`, `Meta+Y`) for a table row on this platform and surface; '' without a chord. */
export function pdfAria(
  id: string,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = pdfSurface(),
): string {
  const action = findShortcut('pdf', id)
  if (!action) throw new Error(`no pdf shortcut row ${id}`)
  return ariaKeyshortcuts(action, platform, surface)
}

/**
 * `pdf-06` lists Next and Previous together (`Ctrl+G`, `Ctrl+Shift+G`, `F3`, `Shift+F3`): a Shift chord
 * whose unshifted twin is in the list is Previous's, the rest are Next's.
 */
function searchStepChords(
  platform: ShortcutPlatform,
  surface: ShortcutSurface,
): { next: string[]; prev: string[] } {
  const action = findShortcut('pdf', 'pdf-06')
  if (!action) throw new Error('no pdf shortcut row pdf-06')
  const chords = chordsFor(action, platform, surface)
  const twin = (chord: string) => {
    const p = parseChord(chord)
    return p ? `${p.ctrl}${p.alt}${p.cmd}${p.key}` : chord
  }
  const plain = new Set(chords.filter((c) => !parseChord(c)?.shift).map(twin))
  const prev = chords.filter((c) => parseChord(c)?.shift && plain.has(twin(c)))
  return { next: chords.filter((c) => !prev.includes(c)), prev }
}

/**
 * What a toolbar button spreads: the visible tooltip (`Redo (Ctrl+Y)`, unchanged) and the chord as
 * `aria-keyshortcuts`. The button's accessible name stays the plain label (its text or `aria-label`).
 */
export function pdfTipProps(
  label: string,
  id: string,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = pdfSurface(),
): { 'data-tip': string; 'aria-keyshortcuts': string | undefined } {
  const keys =
    id === 'pdf-06'
      ? formatAriaChords(searchStepChords(platform, surface).next, platform)
      : pdfAria(id, platform, surface)
  return {
    'data-tip': pdfTip(label, id, platform, surface),
    'aria-keyshortcuts': keys || undefined,
  }
}

/** `pdfTipProps` for the Previous-match button: the Shift chords of `pdf-06`. */
export function pdfPrevMatchProps(
  label: string,
  platform: ShortcutPlatform = currentShortcutPlatform(),
  surface: ShortcutSurface = pdfSurface(),
): { 'data-tip': string; 'aria-keyshortcuts': string | undefined } {
  const keys = formatAriaChords(searchStepChords(platform, surface).prev, platform)
  return {
    'data-tip': pdfPrevMatchTip(label, platform, surface),
    'aria-keyshortcuts': keys || undefined,
  }
}
