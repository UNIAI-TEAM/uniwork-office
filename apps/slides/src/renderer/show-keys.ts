/**
 * Pure key handling for slide shows (PowerPoint keyset): navigation keys, B / . and W / ,
 * blackout toggles, digits + Enter go-to. No React/DOM dependency so the mapping is unit-testable.
 *
 * Keys are matched with the @genoffice/shortcuts matcher (UNI-2011: exact modifiers, IME
 * guard, letters by the physical key on non-Latin layouts). Modifier chords come from the
 * slides table's `slideshow` rows, so they never shadow the editor's keys (Ctrl+H / Cmd+I
 * hide the pointer); the single keys PowerPoint prints without a modifier are SHOW_KEY_ROWS.
 */
import {
  isComposingEvent,
  matchShortcut,
  slidesShortcuts,
  type Chord,
  type PlatformChords,
  type ShortcutAction,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'

export type ShowScreen = 'none' | 'black' | 'white'

export interface ShowKeyState {
  screen: ShowScreen
  /** Digits typed so far for "number + Enter" go-to */
  digits: string
}

export const INITIAL_SHOW_KEYS: ShowKeyState = { screen: 'none', digits: '' }

/** The table's context for slide-show rows: they never shadow the editor's keys. */
export const SLIDESHOW_CONTEXT = 'slideshow'

export type ShowKeyAction =
  | { type: 'exit' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'first' }
  | { type: 'last' }
  /** 1-based slide number as printed in the deck */
  | { type: 'goto'; slideNumber: number }
  /** Hide / show the mouse pointer and the navigation buttons (Ctrl+H / Cmd+I) */
  | { type: 'pointer' }
  /** Key consumed without navigating (digit buffered, buffer cleared, screen toggled or restored) */
  | { type: 'none' }

const NONE: ShowKeyAction = { type: 'none' }

type ShowKey = 'next' | 'prev' | 'first' | 'last' | 'exit' | 'black' | 'white'

/** A single show key in the table's row shape, plus what it does in the show. */
export interface ShowKeyRow extends ShortcutAction {
  readonly show: ShowKey
}

function row(
  id: string,
  show: ShowKey,
  win: Chord[],
  mac: Chord[] = win,
  web?: PlatformChords,
): ShowKeyRow {
  const base = { id, scope: 'slides', context: SLIDESHOW_CONTEXT, win, mac } as const
  return { ...base, ...(web ? { web } : {}), match: 'key', guard: {}, show }
}

/**
 * The single show keys, each naming its `shortcuts.csv` row. They stay here rather than in
 * the slides table (UNI-2011 lead decision): the table's CSV trace reads chords with a
 * modifier only, so bare keys move there with S-table fix2. A test checks every chord
 * against its row's text.
 */
export const SHOW_KEY_ROWS: readonly ShowKeyRow[] = [
  // slides-25: next slide / animation
  row('slides-25', 'next', ['N', 'Enter', 'PageDown', 'Right', 'Down', 'Space']),
  // slides-26: previous slide / animation; the Mac Delete key arrives as Backspace
  row('slides-26', 'prev', ['P', 'PageUp', 'Left', 'Up', 'Backspace']),
  // slides-27: first / last slide
  row('slides-27', 'first', ['Home']),
  row('slides-27', 'last', ['End']),
  // slides-29: end the show; PowerPoint for Mac adds Hyphen and Cmd+Period, the web Esc only
  row('slides-29', 'exit', ['Escape'], ['Escape', 'Minus', 'Cmd+Period'], {
    win: ['Escape'],
    mac: ['Escape'],
  }),
  // slides-30: black (B, Period) / white (W, Comma) screen; PowerPoint for Mac adds Shift
  row('slides-30', 'black', ['B', 'Period'], ['B', 'Shift+B', 'Period']),
  row('slides-30', 'white', ['W', 'Comma'], ['W', 'Shift+W', 'Comma']),
]

/**
 * Maps a keydown to the next state + action; null = not a show key (leave the event alone).
 * `platform` / `surface` pick the chords (PowerPoint for Mac's on macOS, the web's in the
 * web frame).
 */
export function reduceShowKey(
  state: ShowKeyState,
  e: ShortcutKeyEvent,
  platform: ShortcutPlatform = 'win',
  surface: ShortcutSurface = 'desktop',
): { state: ShowKeyState; action: ShowKeyAction } | null {
  if (isComposingEvent(e)) return null
  const tableRow = matchShortcut(e, slidesShortcuts, platform, surface, SLIDESHOW_CONTEXT)
  if (tableRow?.id === 'slides-32') return { state, action: { type: 'pointer' } }
  const matched = matchShortcut(e, SHOW_KEY_ROWS, platform, surface, SLIDESHOW_CONTEXT)
  const show = (matched as ShowKeyRow | null)?.show
  if (show === 'exit') {
    if (state.digits) return { state: { ...state, digits: '' }, action: NONE }
    return { state, action: { type: 'exit' } }
  }
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey
  // Blacked out: any key restores the slide and is otherwise swallowed
  if (state.screen !== 'none') {
    return plain || show ? { state: { screen: 'none', digits: '' }, action: NONE } : null
  }
  // slides-28: the typed slide number, then Enter
  if (plain && /^[0-9]$/.test(e.key)) {
    return { state: { ...state, digits: (state.digits + e.key).slice(-4) }, action: NONE }
  }
  if (show === 'black' || show === 'white') {
    return { state: { screen: show, digits: '' }, action: NONE }
  }
  if (show === 'next' && e.key === 'Enter' && state.digits) {
    return {
      state: { ...state, digits: '' },
      action: { type: 'goto', slideNumber: parseInt(state.digits, 10) },
    }
  }
  if (!show) return null
  return { state: { ...state, digits: '' }, action: { type: show } }
}

/**
 * Next / previous / end for views that only page through slides (the presenter's
 * audience window, the reading view): the show's own keys, nothing else. `platform` /
 * `surface` pick the chords like the show window does (Hyphen / Cmd+Period end it on the Mac).
 */
export function showNavKey(
  e: ShortcutKeyEvent,
  platform: ShortcutPlatform = 'win',
  surface: ShortcutSurface = 'desktop',
): 'next' | 'prev' | 'exit' | null {
  const type = reduceShowKey(INITIAL_SHOW_KEYS, e, platform, surface)?.action.type
  return type === 'next' || type === 'prev' || type === 'exit' ? type : null
}

/** An input, a textarea or a contentEditable: typed keys belong to it. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

/**
 * The reading view's page-turn key. The comments pane and other fields stay open beside the
 * page, so a key typed into one of them (the letters N / P, Backspace, Space, arrows) is not a
 * page turn.
 */
export function readingNavKey(
  e: KeyboardEvent,
  platform: ShortcutPlatform = 'win',
  surface: ShortcutSurface = 'desktop',
): 'next' | 'prev' | 'exit' | null {
  if (isEditableTarget(e.target)) return null
  return showNavKey(e, platform, surface)
}

/**
 * The presenter console's keys: the show's, except the pointer chord (Ctrl+H / Cmd+I): the
 * console has no pointer to hide, and claiming the key would only swallow it.
 */
export function reducePresenterKey(
  state: ShowKeyState,
  e: ShortcutKeyEvent,
  platform: ShortcutPlatform = 'win',
  surface: ShortcutSurface = 'desktop',
): { state: ShowKeyState; action: ShowKeyAction } | null {
  const r = reduceShowKey(state, e, platform, surface)
  return r?.action.type === 'pointer' ? null : r
}

/**
 * Who gets a keydown in the show window: an open menu owns every key (and its Escape), the
 * slide grid closes on Escape instead of ending the show, otherwise the show reducer reads it.
 */
export function showGate(
  e: ShortcutKeyEvent,
  open: { menuOpen: boolean; gridOpen: boolean },
): 'ignore' | 'closeGrid' | 'show' {
  if (open.menuOpen) return 'ignore'
  if (open.gridOpen) return e.key === 'Escape' ? 'closeGrid' : 'ignore'
  return 'show'
}

/** Toggle a blackout screen (menu / toolbar path): same screen again restores the slide */
export function toggleScreen(
  state: ShowKeyState,
  screen: Exclude<ShowScreen, 'none'>,
): ShowKeyState {
  return { screen: state.screen === screen ? 'none' : screen, digits: '' }
}

/**
 * Play-order position for a typed slide number (1-based, numbered as in the deck). Like
 * PowerPoint, a hidden slide's number lands on the next slide the show does play, and a number
 * past the end lands on the show's last slide.
 */
export function gotoPosition(slideNumber: number, order: readonly number[]): number | null {
  if (!Number.isFinite(slideNumber) || slideNumber < 1 || order.length === 0) return null
  const target = slideNumber - 1
  let best = -1
  for (let p = 0; p < order.length; p++) {
    const idx = order[p]!
    if (idx >= target && (best < 0 || idx < order[best]!)) best = p
  }
  return best >= 0 ? best : order.length - 1
}

/** Audience-window input (click / nav key relayed to the presenter): a blackout restores first */
export function reduceAudienceNav(
  state: ShowKeyState,
  action: 'next' | 'prev' | 'exit',
): { state: ShowKeyState; action: ShowKeyAction } {
  if (action === 'exit') return { state, action: { type: 'exit' } }
  if (state.screen !== 'none') return { state: INITIAL_SHOW_KEYS, action: NONE }
  return { state: { ...state, digits: '' }, action: { type: action } }
}

/** Stack of play-order positions left behind by navigation ("Last Viewed" walks it back) */
export function pushVisited(stack: readonly number[], pos: number): number[] {
  if (stack[stack.length - 1] === pos) return [...stack]
  return [...stack.slice(-99), pos]
}
