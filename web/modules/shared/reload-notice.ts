/**
 * A frame that cannot swap its document in place (the text modules read it once at boot) reloads
 * itself for a clean new version (G5-03w, S6). The page restarts, so the "updated to version N" bar
 * and the reading position travel across the reload in sessionStorage: stashed before it, taken
 * once by the next boot of the same document. Nothing here ever throws; storage that is missing,
 * full or blocked only means no bar and the top of the page, which is what a reload was before.
 */
import type { ReloadNotice } from './remote-version'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** the notice belongs to the reload that just happened: an older one is never shown */
const MAX_AGE_MS = 60_000
const KEY_PREFIX = 'uw-reload-notice:'

export interface ScrollPosition {
  /** child indexes from <body> down to the scrolled element; empty = the page itself */
  path: number[]
  top: number
}

interface Stashed {
  /** the document and the head revision the reload asked for: the notice is only for that boot */
  documentId: string
  revision: string | null
  notice: ReloadNotice
  scroll: ScrollPosition[]
  at: number
}

export interface TakenReload {
  notice: ReloadNotice
  scroll: ScrollPosition[]
}

function sessionStore(): Store | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function pathOf(el: Element, body: Element): number[] {
  const path: number[] = []
  for (let node: Element | null = el; node && node !== body; node = node.parentElement) {
    const parent: Element | null = node.parentElement
    if (!parent) return []
    path.unshift(Array.prototype.indexOf.call(parent.children, node))
  }
  return path
}

function nodeAt(path: readonly number[], body: Element): Element | null {
  let node: Element | null = body
  for (const index of path) node = node?.children[index] ?? null
  return node
}

/** every scrolled element (and the page) of the document, so the reload can put them back */
export function captureScroll(doc: Document = document): ScrollPosition[] {
  const out: ScrollPosition[] = []
  const view = doc.defaultView
  const page = view?.scrollY ?? 0
  if (page > 0) out.push({ path: [], top: page })
  const body = doc.body
  for (const el of body.querySelectorAll('*')) {
    if (el.scrollTop > 0) out.push({ path: pathOf(el, body), top: el.scrollTop })
    if (out.length >= 8) break
  }
  return out
}

/**
 * Put the positions back once the renderer has drawn the document: a few tries while the page is
 * still too short, never after the user has scrolled, typed or clicked. Returns the cancel.
 */
export function restoreScroll(
  positions: readonly ScrollPosition[],
  doc: Document = document,
  tries = 30,
  everyMs = 100,
): () => void {
  const view = doc.defaultView
  if (!view || positions.length === 0) return () => {}
  const left = new Map(positions.map((p, i) => [i, p]))
  let timer: ReturnType<typeof setTimeout> | null = null
  const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const
  const stop = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    left.clear()
    for (const name of events) view.removeEventListener(name, stop, true)
  }
  for (const name of events) view.addEventListener(name, stop, { capture: true, passive: true })
  const step = (n: number): void => {
    for (const [i, p] of left) {
      if (p.path.length === 0) {
        if (doc.documentElement.scrollHeight - view.innerHeight >= p.top) {
          view.scrollTo(0, p.top)
          left.delete(i)
        }
        continue
      }
      const el = nodeAt(p.path, doc.body)
      if (el && el.scrollHeight - el.clientHeight >= p.top) {
        el.scrollTop = p.top
        left.delete(i)
      }
    }
    if (left.size === 0 || n <= 1) return stop()
    timer = setTimeout(() => step(n - 1), everyMs)
  }
  step(tries)
  return stop
}

export function stashReload(
  documentId: string,
  notice: ReloadNotice,
  scroll: ScrollPosition[],
  store: Store | null = sessionStore(),
  now: number = Date.now(),
): void {
  if (!store) return
  const value: Stashed = { documentId, revision: notice.revision, notice, scroll, at: now }
  try {
    store.setItem(KEY_PREFIX + documentId, JSON.stringify(value))
  } catch {
    /* no storage: the reload still happens, without the bar */
  }
}

/**
 * The notice the previous page left for this document, once. `opened` is the head the boot
 * opened: a head newer than the one the reload asked for (another save slipped in) shows the
 * number it really loaded, without an author or time that belong to the older version.
 */
export function takeReload(
  documentId: string,
  opened: { revision: string | null; modifiedAt?: number },
  store: Store | null = sessionStore(),
  now: number = Date.now(),
): TakenReload | null {
  const revision = opened.revision
  if (!store) return null
  const key = KEY_PREFIX + documentId
  let raw: string | null
  try {
    raw = store.getItem(key)
    if (raw !== null) store.removeItem(key)
  } catch {
    return null
  }
  if (raw === null) return null
  let value: Stashed
  try {
    value = JSON.parse(raw) as Stashed
  } catch {
    return null
  }
  if (value?.documentId !== documentId || typeof value.at !== 'number') return null
  if (now - value.at > MAX_AGE_MS || now < value.at) return null
  const scroll = Array.isArray(value.scroll) ? value.scroll : []
  const asked = value.notice?.revision ?? null
  if (revision !== null && asked !== null && revision !== asked) {
    // an older head than the reload asked for was not what the user was told about
    try {
      if (BigInt(revision) < BigInt(asked)) return null
    } catch {
      return null
    }
    return { notice: { revision, author: null, savedAt: opened.modifiedAt ?? null }, scroll }
  }
  return { notice: value.notice, scroll }
}
