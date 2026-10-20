/**
 * Pure key handling for slide shows (PowerPoint keyset): navigation keys, B / . and W / ,
 * blackout toggles, digits + Enter go-to. No React/DOM dependency so the mapping is unit-testable.
 *
 * Modifier chords come from the @genoffice/shortcuts slides table's `slideshow` rows
 * (UNI-2011), so they never shadow the editor's keys: Ctrl+H / Cmd+I hide the pointer.
 * The single keys below (N, P, arrows, B, W, Esc...) are printed by PowerPoint without a
 * modifier, which the table's CSV tracing cannot read yet; they stay listed here.
 */
import {
  isComposingEvent,
  matchShortcut,
  slidesShortcuts,
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

const NAV_KEYS: Record<string, 'next' | 'prev' | 'first' | 'last'> = {
  n: 'next',
  ArrowRight: 'next',
  ArrowDown: 'next',
  ' ': 'next',
  Enter: 'next',
  PageDown: 'next',
  p: 'prev',
  ArrowLeft: 'prev',
  ArrowUp: 'prev',
  PageUp: 'prev',
  // the Mac Delete key arrives as Backspace
  Backspace: 'prev',
  Home: 'first',
  End: 'last',
}

const SCREEN_KEYS: Record<string, ShowScreen> = {
  b: 'black',
  '.': 'black',
  w: 'white',
  ',': 'white',
}

/** The key as the tables above spell it: letters lower-case, read from the physical key
 * when the layout types no Latin letter (Cyrillic, Greek...). */
function showKeyName(e: ShortcutKeyEvent): string {
  if (e.key.length !== 1) return e.key
  const letter = e.key.toLowerCase()
  if (/^[a-z]$/.test(letter)) return letter
  const physical = /^Key([A-Z])$/.exec(e.code)
  return physical ? physical[1]!.toLowerCase() : e.key
}

/**
 * Maps a keydown to the next state + action; null = not a show key (leave the event alone).
 * `platform` / `surface` pick the table's chords (PowerPoint for Mac's on macOS, the web
 * column in the web frame).
 */
export function reduceShowKey(
  state: ShowKeyState,
  e: ShortcutKeyEvent,
  platform: ShortcutPlatform = 'win',
  surface: ShortcutSurface = 'desktop',
): { state: ShowKeyState; action: ShowKeyAction } | null {
  if (isComposingEvent(e)) return null
  const row = matchShortcut(e, slidesShortcuts, platform, surface, SLIDESHOW_CONTEXT)
  if (row?.id === 'slides-32') return { state, action: { type: 'pointer' } }
  // the single show keys never carry Ctrl / Cmd / Alt (Shift+B / Shift+W still black out)
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const key = showKeyName(e)
  if (key === 'Escape') {
    if (state.digits) return { state: { ...state, digits: '' }, action: NONE }
    return { state, action: { type: 'exit' } }
  }
  // Blacked out: any key restores the slide and is otherwise swallowed
  if (state.screen !== 'none') return { state: { screen: 'none', digits: '' }, action: NONE }
  if (/^[0-9]$/.test(key)) {
    return { state: { ...state, digits: (state.digits + key).slice(-4) }, action: NONE }
  }
  const screen = SCREEN_KEYS[key]
  if (screen) return { state: { screen, digits: '' }, action: NONE }
  if (key === 'Enter' && state.digits) {
    return {
      state: { ...state, digits: '' },
      action: { type: 'goto', slideNumber: parseInt(state.digits, 10) },
    }
  }
  const nav = NAV_KEYS[key]
  if (!nav) return null
  return { state: { ...state, digits: '' }, action: { type: nav } }
}

/**
 * Next / previous / end for views that only page through slides (the presenter's
 * audience window, the reading view): the show's own keys, nothing else.
 */
export function showNavKey(e: ShortcutKeyEvent): 'next' | 'prev' | 'exit' | null {
  const type = reduceShowKey(INITIAL_SHOW_KEYS, e)?.action.type
  return type === 'next' || type === 'prev' || type === 'exit' ? type : null
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
