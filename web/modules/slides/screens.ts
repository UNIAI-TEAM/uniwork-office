/**
 * Audience window placement through the Window Management API (getScreenDetails, permission
 * "window-management"), used by ./presenter-window.ts. Granted: the audience window opens on
 * (or is moved to) another screen than the presenter's, sized to that screen's available area,
 * and "swap displays" moves it on to the next screen. Unsupported, denied or a single screen: the
 * window opens at a default size and the user drags it to the projector (graceful fallback).
 * Fullscreen itself is entered in the audience window on its first click (browsers grant
 * fullscreen only to the window that received the user's gesture).
 */

export interface ScreenLike {
  availLeft: number
  availTop: number
  availWidth: number
  availHeight: number
  isPrimary?: boolean
  label?: string
}

export interface ScreenDetailsLike {
  screens: readonly ScreenLike[]
  currentScreen: ScreenLike
}

type WindowWithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetailsLike> }

/** a window the placer can move (the audience WindowProxy) */
export interface MovableWindow {
  moveTo(x: number, y: number): void
  resizeTo(w: number, h: number): void
  readonly screenX?: number
  readonly screenY?: number
}

/** default audience size without placement: 16:9, fits common laptop screens */
export const DEFAULT_AUDIENCE_SIZE = { width: 960, height: 540 }

const sameScreen = (a: ScreenLike, b: ScreenLike): boolean =>
  a === b ||
  (a.availLeft === b.availLeft &&
    a.availTop === b.availTop &&
    a.availWidth === b.availWidth &&
    a.availHeight === b.availHeight)

/** the screen the audience goes to: the first screen after `from` that is not the presenter's */
export function pickScreen(
  details: ScreenDetailsLike,
  from: ScreenLike | null = null,
): ScreenLike | null {
  const all = details.screens
  if (all.length < 2) return null
  const start = from ? all.findIndex((s) => sameScreen(s, from)) : -1
  for (let i = 1; i <= all.length; i++) {
    const s = all[(start + i + all.length) % all.length]!
    if (!sameScreen(s, details.currentScreen) && (!from || !sameScreen(s, from))) return s
  }
  return null
}

export function popupFeatures(s: ScreenLike | null): string {
  if (!s) return `popup,width=${DEFAULT_AUDIENCE_SIZE.width},height=${DEFAULT_AUDIENCE_SIZE.height}`
  return `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`
}

export interface ScreenPlacer {
  /** start loading the screen details; call synchronously inside the click (may prompt once) */
  request(): Promise<ScreenDetailsLike | null>
  /** window.open features for the next audience window (placed only when details are known) */
  features(): string
  /** move + size `win` onto the audience screen; false without details or a second screen */
  place(win: MovableWindow): Promise<boolean>
  /** move `win` on to the next screen (swap displays); false when there is nowhere to go */
  next(win: MovableWindow): Promise<boolean>
}

export function createScreenPlacer(w: Window = window): ScreenPlacer {
  const api = w as WindowWithScreens
  let details: ScreenDetailsLike | null = null
  let pending: Promise<ScreenDetailsLike | null> | null = null
  let refused = false
  /** the screen the audience window was last put on */
  let current: ScreenLike | null = null

  function request(): Promise<ScreenDetailsLike | null> {
    if (details) return Promise.resolve(details)
    if (refused || typeof api.getScreenDetails !== 'function') return Promise.resolve(null)
    if (pending) return pending
    let call: Promise<ScreenDetailsLike>
    try {
      // called synchronously: a permission prompt needs the click's user activation
      call = api.getScreenDetails()
    } catch {
      refused = true
      return Promise.resolve(null)
    }
    pending = call.then(
      (d) => {
        details = d
        return d
      },
      () => {
        // denied (or dismissed): never prompt again in this session, fall back to dragging
        refused = true
        return null
      },
    )
    void pending.finally(() => {
      pending = null
    })
    return pending
  }

  function moveOnto(win: MovableWindow, s: ScreenLike): boolean {
    try {
      win.moveTo(s.availLeft, s.availTop)
      win.resizeTo(s.availWidth, s.availHeight)
    } catch {
      return false
    }
    current = s
    return true
  }

  return {
    request,
    features() {
      const s = details ? pickScreen(details) : null
      if (s) current = s
      return popupFeatures(s)
    },
    async place(win) {
      const d = await request()
      const s = d ? pickScreen(d) : null
      return s ? moveOnto(win, s) : false
    },
    async next(win) {
      const d = await request()
      const s = d ? pickScreen(d, current) : null
      return s ? moveOnto(win, s) : false
    },
  }
}
