/**
 * Presenter <-> audience window protocol of the Slides web frame (GO-B5 SP1, UNI-1015, CONTRACT C15(2)).
 *
 * The desktop forwards the show through Electron main (apps/slides/src/main/presenter-show.ts): the
 * audience window shares the presenter's session, receives `slides:show-sync` / `slides:show-ink`
 * and sends `slides:audience-nav` back. On the web the presenter frame opens the audience window
 * itself (window.open of its own index.html?mode=audience) and the same three flows, plus the few
 * read-only deck queries the audience renders from, travel over a private MessageChannel:
 *
 *   1. audience -> opener (window.postMessage, target origin = own origin): `hello` + show id
 *   2. presenter -> audience (window.postMessage + transferred MessagePort): `connect`
 *   3. everything else on the port (typed below); the audience then drops `window.opener`
 *
 * Every message is validated on receipt (`parse*`): wrong namespace / version / shape = ignored.
 * Requests are limited to AUDIENCE_METHODS, all read-only, so the audience window cannot edit,
 * save or reach the host protocol through the presenter.
 */
import type { RenderSlide } from '@genoffice/pptx-render'
import type {
  AnimationItem,
  AudienceNavAction,
  ShapeKey,
  ShowInkEvent,
  ShowSyncState,
  TransitionKind,
} from '../../../apps/slides/src/shared/ipc'

export const AUDIENCE_NS = 'uniwork.office.slides.audience'
export const AUDIENCE_V = 1

/** the URL mode the renderer entry switches on (apps/slides/src/renderer/main.tsx) */
export const AUDIENCE_MODE = 'audience'
/** query parameter carrying the show id that pairs one audience window with its presenter */
export const SHOW_PARAM = 'show'

/** an embedded font face the audience registers before drawing (the presenter's FontFace bytes) */
export interface EmbeddedFontSource {
  family: string
  weight: string
  style: string
  bytes: ArrayBuffer
}

/** media bytes (the audience makes its own blob: URL: media-src blob:, no cross-window URLs) */
export interface MediaBytes {
  kind: 'video' | 'audio'
  mime: string
  bytes: ArrayBuffer
}

/** read-only queries the audience may ask the presenter; nothing else is served */
export interface AudienceMethods {
  getRenderSlides: () => RenderSlide[]
  getTransition: (slideIndex: number) => TransitionKind
  getAnimations: (slideIndex: number) => AnimationItem[]
  getShapeKeys: (slideIndex: number) => ShapeKey[]
  getMediaBytes: (slideIndex: number, sourceId: string) => MediaBytes | null
  getEmbeddedFonts: () => EmbeddedFontSource[]
  getLanguage: () => string
  /** the presenter's latest sync state (audience mounted after the first broadcast) */
  audienceReady: () => ShowSyncState | null
}
export type AudienceMethod = keyof AudienceMethods

export const AUDIENCE_METHODS: readonly AudienceMethod[] = [
  'getRenderSlides',
  'getTransition',
  'getAnimations',
  'getShapeKeys',
  'getMediaBytes',
  'getEmbeddedFonts',
  'getLanguage',
  'audienceReady',
]

/** window.postMessage handshake */
export type HandshakeMessage =
  | { ns: typeof AUDIENCE_NS; v: typeof AUDIENCE_V; t: 'hello'; show: string }
  | { ns: typeof AUDIENCE_NS; v: typeof AUDIENCE_V; t: 'connect'; show: string }

/** presenter -> audience, on the port */
export type ToAudience =
  | { t: 'sync'; state: ShowSyncState }
  | { t: 'ink'; ev: ShowInkEvent }
  | { t: 'deck'; slides: RenderSlide[] }
  | { t: 'res'; id: number; ok: true; value: unknown }
  | { t: 'res'; id: number; ok: false; error: string }
  | { t: 'end' }

/** audience -> presenter, on the port */
export type ToPresenter =
  | { t: 'req'; id: number; method: AudienceMethod; args: unknown[] }
  | { t: 'nav'; action: AudienceNavAction }
  | { t: 'bye' }

const NAV_ACTIONS: readonly AudienceNavAction[] = ['next', 'prev', 'exit']
const SHOW_ID = /^[0-9A-Za-z_-]{8,64}$/

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0
const isUnit = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

export function isShowId(x: unknown): x is string {
  return typeof x === 'string' && SHOW_ID.test(x)
}

export function newShowId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function handshake(t: HandshakeMessage['t'], show: string): HandshakeMessage {
  return { ns: AUDIENCE_NS, v: AUDIENCE_V, t, show }
}

export function parseHandshake(x: unknown): HandshakeMessage | null {
  if (!isObj(x) || x.ns !== AUDIENCE_NS || x.v !== AUDIENCE_V || !isShowId(x.show)) return null
  return x.t === 'hello' || x.t === 'connect' ? (x as HandshakeMessage) : null
}

export function parseSyncState(x: unknown): ShowSyncState | null {
  if (!isObj(x) || !isInt(x.idx) || !isInt(x.played)) return null
  for (const k of ['playing', 'fresh', 'ended', 'black'] as const)
    if (typeof x[k] !== 'boolean') return null
  if (x.white !== undefined && typeof x.white !== 'boolean') return null
  return {
    idx: x.idx,
    played: x.played,
    playing: x.playing as boolean,
    fresh: x.fresh as boolean,
    ended: x.ended as boolean,
    black: x.black as boolean,
    ...(x.white !== undefined ? { white: x.white as boolean } : {}),
  }
}

export function parseInkEvent(x: unknown): ShowInkEvent | null {
  if (!isObj(x)) return null
  if (x.type === 'clear') return { type: 'clear' }
  if (!isUnit(x.x) || !isUnit(x.y)) return null
  if (x.type === 'laser') return { type: 'laser', x: x.x, y: x.y }
  if (x.type === 'stroke-move') return { type: 'stroke-move', x: x.x, y: x.y }
  if (x.type === 'stroke-start' && typeof x.color === 'string' && x.color.length <= 64)
    return { type: 'stroke-start', x: x.x, y: x.y, color: x.color }
  return null
}

export function parseToAudience(x: unknown): ToAudience | null {
  if (!isObj(x)) return null
  switch (x.t) {
    case 'sync': {
      const state = parseSyncState(x.state)
      return state ? { t: 'sync', state } : null
    }
    case 'ink': {
      const ev = parseInkEvent(x.ev)
      return ev ? { t: 'ink', ev } : null
    }
    case 'deck':
      return Array.isArray(x.slides) ? { t: 'deck', slides: x.slides as RenderSlide[] } : null
    case 'res':
      if (!isInt(x.id)) return null
      if (x.ok === true) return { t: 'res', id: x.id, ok: true, value: x.value }
      if (x.ok === false)
        return { t: 'res', id: x.id, ok: false, error: String(x.error ?? 'error') }
      return null
    case 'end':
      return { t: 'end' }
    default:
      return null
  }
}

export function parseToPresenter(x: unknown): ToPresenter | null {
  if (!isObj(x)) return null
  switch (x.t) {
    case 'req':
      if (!isInt(x.id) || !Array.isArray(x.args) || x.args.length > 4) return null
      if (!(AUDIENCE_METHODS as readonly unknown[]).includes(x.method)) return null
      return { t: 'req', id: x.id, method: x.method as AudienceMethod, args: x.args }
    case 'nav':
      return (NAV_ACTIONS as readonly unknown[]).includes(x.action)
        ? { t: 'nav', action: x.action as AudienceNavAction }
        : null
    case 'bye':
      return { t: 'bye' }
    default:
      return null
  }
}

/** the audience URL: the frame's own page in audience mode (same bundle, same CSP header) */
export function audienceUrl(frameHref: string, show: string): string {
  const url = new URL(frameHref)
  url.search = ''
  url.hash = ''
  url.searchParams.set('mode', AUDIENCE_MODE)
  url.searchParams.set(SHOW_PARAM, show)
  return url.href
}

/** show id of an audience page URL, null when the page is not an audience window */
export function audienceShowId(search: string): string | null {
  const q = new URLSearchParams(search)
  const show = q.get(SHOW_PARAM)
  return q.get('mode') === AUDIENCE_MODE && isShowId(show) ? show : null
}
