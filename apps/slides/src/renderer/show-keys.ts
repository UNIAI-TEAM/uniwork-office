/**
 * Pure key handling for slide shows (PowerPoint keyset): navigation keys, B / . and W / ,
 * blackout toggles, digits + Enter go-to. No React/DOM dependency so the mapping is unit-testable.
 *
 * Keys are matched with the @genoffice/shortcuts matcher (UNI-2011: exact modifiers, IME
 * guard, letters by the physical key on non-Latin layouts). Modifier chords come from the
 * slides table's `slideshow` rows, so they never shadow the editor's keys (Ctrl+H / Cmd+I
 * hide the pointer); the single keys PowerPoint prints without a modifier are rows too (slides-25..30).
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

type ShowKey = 'next' | 'prev' | 'first' | 'last' | 'exit' | 'black' | 'white'

/** True when the key typed an ASCII character (a layout the matcher reads by character). */
function typesAscii(e: ShortcutKeyEvent): boolean {
  return /^[!-~]$/.test(e.key)
}

/**
 * What a matched show row does. The single-key rows are the slides table's `slideshow` rows
 * (slides-25..30); rows that hold two actions (Home / End, black / white) read it from the key:
 * by character, with the physical key for a layout that types no ASCII (Cyrillic B / W).
 */
function showOf(id: string, e: ShortcutKeyEvent): ShowKey | null {
  switch (id) {
    case 'slides-25':
      return 'next'
    case 'slides-26':
      return 'prev'
    case 'slides-27':
      return e.key === 'End' ? 'last' : 'first'
    case 'slides-29':
      return 'exit'
    case 'slides-30': {
      const k = typesAscii(e) ? e.key.toLowerCase() : e.code
      return k === 'b' || k === '.' || k === 'KeyB' ? 'black' : 'white'
    }
    default:
      return null
  }
}

/**
 * PowerPoint for Mac also blanks the show on Shift+B / Shift+W (slides-30). The table's
 * chord trace does not read a Shift+letter from the CSV text, so the two chords are read here.
 */
function macShiftedScreen(e: ShortcutKeyEvent, platform: ShortcutPlatform): ShowKey | null {
  if (platform !== 'mac' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null
  const k = typesAscii(e) ? e.key.toLowerCase() : e.code
  if (k === 'b' || k === 'KeyB') return 'black'
  return k === 'w' || k === 'KeyW' ? 'white' : null
}

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
  const matched = matchShortcut(e, slidesShortcuts, platform, surface, SLIDESHOW_CONTEXT)
  if (matched?.id === 'slides-32') return { state, action: { type: 'pointer' } }
  const show = matched ? showOf(matched.id, e) : macShiftedScreen(e, platform)
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
