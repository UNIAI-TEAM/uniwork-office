/**
 * Presenter side of the web presenter view (GO-B5 SP1, UNI-1015, CONTRACT C15(2)): the slidesApi
 * presenter* / onAudienceNav methods of the frame. Mirrors apps/slides/src/main/presenter-show.ts:
 *
 * | desktop (Electron main)                         | web (this module, in the presenter frame)              |
 * |-------------------------------------------------|--------------------------------------------------------|
 * | presenter-start opens a BrowserWindow on the    | presenterOpenAudience (a click: browsers open windows  |
 * | external display                                | only from a gesture) window.open's ?mode=audience,     |
 * |                                                 | placed by ./screens.ts when the user grants it         |
 * | audience shares the presenter's session         | audience asks AUDIENCE_METHODS over a MessagePort      |
 * | presenter-sync / presenter-ink -> show-sync/ink | `sync` / `ink` on the port (lastSync kept for late     |
 * |                                                 | mounts, like `lastSync` + audience-ready)              |
 * | audience-nav -> presenter                       | `nav` on the port                                      |
 * | presenter-swap moves windows between displays   | moves the audience window to the next screen           |
 * | presenter-end / presenter destroyed closes it   | presenterEnd / presenterCloseAudience / frame pagehide |
 * | audience closed -> audienceWin = null           | `bye` or `closed` -> onPresenterAudience(false); the   |
 * |                                                 | presenter view keeps running on its own                |
 */
import type { RenderSlide } from '@genoffice/pptx-render'
import type {
  AudienceNavAction,
  ShowInkEvent,
  ShowSyncState,
  SlidesApi,
} from '../../../apps/slides/src/shared/ipc'
import {
  audienceArgsValid,
  audienceUrl,
  handshake,
  newShowId,
  parseHandshake,
  parseToPresenter,
  type AudienceMethod,
  type AudienceMethods,
  type ToAudience,
} from './presenter-protocol'
import { createScreenPlacer, type ScreenPlacer } from './screens'

type Async<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<R> | R : never
/** what the presenter serves the audience: the read-only deck queries of the frame's engine */
export type AudienceSource = {
  [K in Exclude<AudienceMethod, 'audienceReady'>]: Async<AudienceMethods[K]>
}

export interface PresenterWindowOptions {
  source: AudienceSource
  /** the browser's window.open (./native-open.ts), not the external-link guard */
  open: typeof window.open | null
  /** the presenter frame (tests pass a fake) */
  win?: Window
  screens?: ScreenPlacer
  /** how often a closed audience window is noticed without its `bye` (ms) */
  pollMs?: number
}

type PresenterApi = Pick<
  SlidesApi,
  | 'presenterStart'
  | 'presenterSync'
  | 'presenterInk'
  | 'presenterSwap'
  | 'presenterEnd'
  | 'onAudienceNav'
  | 'presenterOpenAudience'
  | 'presenterCloseAudience'
  | 'onPresenterAudience'
>

interface Audience {
  show: string
  win: Window
  port: MessagePort | null
  poll: ReturnType<typeof setInterval>
}

export function createPresenterWindow(opts: PresenterWindowOptions) {
  const w = opts.win ?? window
  const screens = opts.screens ?? createScreenPlacer(w)
  const navHandlers = new Set<(action: AudienceNavAction) => void>()
  const audienceHandlers = new Set<(open: boolean) => void>()
  let active = false
  let lastSync: ShowSyncState | null = null
  let audience: Audience | null = null

  const emitAudience = (open: boolean) => {
    for (const h of [...audienceHandlers]) h(open)
  }

  function post(msg: ToAudience): void {
    try {
      audience?.port?.postMessage(msg)
    } catch {
      /* a closing window: its `closed` poll tears down */
    }
  }

  /** forget the audience window (it is closed or closing); tells the presenter view once */
  function drop(close: boolean): void {
    const a = audience
    if (!a) return
    audience = null
    clearInterval(a.poll)
    if (a.port) {
      try {
        a.port.postMessage({ t: 'end' } satisfies ToAudience)
      } catch {
        /* already gone */
      }
      a.port.onmessage = null
      a.port.close()
    }
    if (close && !a.win.closed) {
      try {
        a.win.close()
      } catch {
        /* not ours to close any more */
      }
    }
    emitAudience(false)
  }

  async function serve(port: MessagePort, id: number, method: AudienceMethod, args: unknown[]) {
    let reply: ToAudience
    try {
      if (!audienceArgsValid(method, args)) throw new Error('bad arguments')
      const value =
        method === 'audienceReady'
          ? lastSync
          : await (opts.source[method] as (...a: unknown[]) => unknown)(...args)
      reply = { t: 'res', id, ok: true, value }
    } catch (e) {
      reply = { t: 'res', id, ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (audience?.port === port) post(reply)
  }

  function connect(a: Audience): void {
    const channel = new MessageChannel()
    a.port = channel.port1
    channel.port1.onmessage = (e: MessageEvent) => {
      const msg = parseToPresenter(e.data)
      if (!msg || audience !== a) return
      if (msg.t === 'req') void serve(channel.port1, msg.id, msg.method, msg.args)
      else if (msg.t === 'nav') for (const h of [...navHandlers]) h(msg.action)
      else drop(false)
    }
    a.win.postMessage(handshake('connect', a.show), w.location.origin, [channel.port2])
    if (lastSync) post({ t: 'sync', state: lastSync })
  }

  // the audience page says hello to its opener once its bridge is installed
  w.addEventListener('message', (e: MessageEvent) => {
    const a = audience
    if (!a || a.port || e.source !== a.win || e.origin !== w.location.origin) return
    const msg = parseHandshake(e.data)
    if (msg?.t === 'hello' && msg.show === a.show) connect(a)
  })
  // the presenter tab goes away: the audience window must not stay behind
  w.addEventListener('pagehide', () => drop(true))

  async function openAudience(): Promise<{ audience: boolean; blocked?: boolean }> {
    if (audience && !audience.win.closed) {
      audience.win.focus()
      return { audience: true }
    }
    if (audience) drop(false)
    if (!opts.open) return { audience: false, blocked: true }
    // both inside the click: the screen-details request (may prompt) and the popup itself
    const details = screens.request()
    const show = newShowId()
    let win: Window | null
    try {
      win = opts.open(
        audienceUrl(w.location.href, show),
        `uniwork-audience-${show}`,
        screens.features(),
      )
    } catch {
      win = null
    }
    if (!win) return { audience: false, blocked: true }
    const a: Audience = {
      show,
      win,
      port: null,
      poll: setInterval(() => {
        if (audience === a && a.win.closed) drop(false)
      }, opts.pollMs ?? 500),
    }
    audience = a
    emitAudience(true)
    void details.then(() => (audience === a ? screens.place(a.win) : false)).catch(() => false)
    return { audience: true }
  }

  const api: PresenterApi = {
    presenterStart: async () => {
      active = true
      lastSync = null
      return { audience: audience != null }
    },
    presenterSync: (state) => {
      if (!active) return
      lastSync = state
      post({ t: 'sync', state })
    },
    presenterInk: (ev: ShowInkEvent) => {
      if (active) post({ t: 'ink', ev })
    },
    presenterSwap: async () => (audience ? screens.next(audience.win) : false),
    presenterEnd: async () => {
      active = false
      lastSync = null
      drop(true)
    },
    onAudienceNav: (handler) => {
      navHandlers.add(handler)
      return () => navHandlers.delete(handler)
    },
    presenterOpenAudience: async () => (active ? openAudience() : { audience: false }),
    presenterCloseAudience: async () => drop(true),
    onPresenterAudience: (handler) => {
      audienceHandlers.add(handler)
      return () => audienceHandlers.delete(handler)
    },
  }

  return {
    api,
    /** the presenter's latest state (served to a late audience as `audienceReady`) */
    lastSync: () => lastSync,
    /** forward a deck change (onDeckChanged) to an open audience window */
    deckChanged: (slides: RenderSlide[]) => post({ t: 'deck', slides }),
    /** for tests and the e2e driver */
    audienceOpen: () => audience != null && audience.port != null,
  }
}

export type PresenterWindow = ReturnType<typeof createPresenterWindow>
