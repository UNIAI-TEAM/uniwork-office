/**
 * Audience window bridge (GO-B5 SP1, UNI-1015): window.slidesApi for index.html?mode=audience&show=<id>,
 * the window the presenter view opens (./presenter-window.ts). The renderer entry then mounts
 * AudienceView exactly as on the desktop (apps/slides/src/renderer/main.tsx).
 *
 * This page has no host, no protocol client and no document engine: it says hello to its opener,
 * receives a private MessagePort, drops `window.opener`, and from then on only renders what the
 * presenter serves (AUDIENCE_METHODS, read-only) and mirrors its sync / ink broadcasts. Its
 * navigation input goes back as `nav`. It closes itself when the presenter ends the show, when
 * the presenter frame goes away, and when it was opened without a presenter (e.g. reloaded).
 */
import type { RenderSlide } from '@genoffice/pptx-render'
import type {
  AudienceNavAction,
  OpenResult,
  ShowInkEvent,
  ShowSyncState,
  SlidesApi,
} from '../../../apps/slides/src/shared/ipc'
import { safeApi, type BridgeObject } from '../../docs/bridge/safe-api'
import {
  AUDIENCE_NS,
  handshake,
  parseHandshake,
  parseToAudience,
  type AudienceMethod,
  type AudienceMethods,
  type ToPresenter,
} from './presenter-protocol'

export interface AudienceBridgeOptions {
  show: string
  /** the audience window (tests pass a fake) */
  win?: Window
  /** how often hello is repeated until the presenter answers, and the presenter is checked (ms) */
  retryMs?: number
  /** give up (close) when no presenter answered within this time (ms) */
  connectTimeoutMs?: number
}

type DeckEvent = { slides: OpenResult['slides']; size: { cx: number; cy: number } }

export function createAudienceBridge(opts: AudienceBridgeOptions) {
  const w = opts.win ?? window
  const retryMs = opts.retryMs ?? 250
  const syncHandlers = new Set<(s: ShowSyncState) => void>()
  const inkHandlers = new Set<(ev: ShowInkEvent) => void>()
  const deckHandlers = new Set<(ev: DeckEvent) => void>()
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const mediaUrls = new Map<string, string>()
  let seq = 0
  let port: MessagePort | null = null
  let closed = false
  let resolvePort!: (p: MessagePort) => void
  const portReady = new Promise<MessagePort>((r) => (resolvePort = r))

  const presenter = w.opener as Window | null

  function close(): void {
    if (closed) return
    closed = true
    clearInterval(timer)
    for (const p of pending.values()) p.reject(new Error('presenter view ended'))
    pending.clear()
    for (const url of mediaUrls.values()) URL.revokeObjectURL(url)
    mediaUrls.clear()
    if (port) {
      port.onmessage = null
      port.close()
    }
    try {
      w.close()
    } catch {
      /* nothing else to do */
    }
  }

  function send(msg: ToPresenter): void {
    try {
      port?.postMessage(msg)
    } catch {
      /* presenter gone: the presenter poll closes this window */
    }
  }

  async function request<K extends AudienceMethod>(
    method: K,
    ...args: Parameters<AudienceMethods[K]>
  ): Promise<ReturnType<AudienceMethods[K]>> {
    const p = await portReady
    const id = ++seq
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      p.postMessage({ t: 'req', id, method, args } satisfies ToPresenter)
    })
  }

  function onPortMessage(e: MessageEvent): void {
    const msg = parseToAudience(e.data)
    if (!msg) return
    switch (msg.t) {
      case 'sync':
        for (const h of [...syncHandlers]) h(msg.state)
        return
      case 'ink':
        for (const h of [...inkHandlers]) h(msg.ev)
        return
      case 'deck': {
        const first = msg.slides[0]
        const size = { cx: first?.widthPx ?? 0, cy: first?.heightPx ?? 0 }
        for (const h of [...deckHandlers]) h({ slides: msg.slides, size })
        return
      }
      case 'res': {
        const p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        if (msg.ok) p.resolve(msg.value)
        else p.reject(new Error(msg.error))
        return
      }
      case 'end':
        close()
    }
  }

  // ---- handshake: hello (repeated) -> connect + port -> drop the opener

  const onWindowMessage = (e: MessageEvent) => {
    if (port || !presenter || e.source !== presenter || e.origin !== w.location.origin) return
    const msg = parseHandshake(e.data)
    const p = e.ports?.[0]
    if (msg?.t !== 'connect' || msg.show !== opts.show || !p) return
    port = p
    p.onmessage = onPortMessage
    w.removeEventListener('message', onWindowMessage)
    // the presenter frame is same-origin with the UniWork page: keep no handle beyond the port
    try {
      ;(w as { opener: unknown }).opener = null
    } catch {
      /* read-only in some test windows */
    }
    resolvePort(p)
  }

  const startedAt = Date.now()
  const hello = () => {
    if (port || !presenter || presenter.closed) return
    try {
      presenter.postMessage(handshake('hello', opts.show), w.location.origin)
    } catch {
      /* presenter navigated away */
    }
  }
  const timer = setInterval(() => {
    // the presenter frame went away (tab closed, frame reloaded): the show is over
    if (!presenter || presenter.closed) return close()
    if (!port) {
      if (Date.now() - startedAt > (opts.connectTimeoutMs ?? 10_000)) return close()
      hello()
    }
  }, retryMs)

  if (!presenter) {
    // opened by hand or reloaded (the opener was dropped): nothing to present
    queueMicrotask(close)
  } else {
    w.addEventListener('message', onWindowMessage)
    hello()
  }
  w.addEventListener('pagehide', () => {
    send({ t: 'bye' })
    clearInterval(timer)
  })

  // ---- fonts: the presenter's embedded faces must exist here before the first draw

  const fontsReady: Promise<void> = (async () => {
    try {
      const faces = await request('getEmbeddedFonts')
      const doc = w.document
      const added: FontFace[] = []
      if (typeof FontFace !== 'undefined' && doc.fonts) {
        for (const f of faces) {
          const face = new FontFace(f.family, f.bytes, { weight: f.weight, style: f.style })
          doc.fonts.add(face)
          added.push(face)
        }
      }
      await Promise.all([
        ...added.map((face) => face.load().catch(() => null)),
        ...['', 'bold ', 'italic ', 'italic bold '].map((v) =>
          doc.fonts?.load?.(`${v}16px Carlito`).catch(() => []),
        ),
      ])
    } catch {
      /* best-effort, as on the desktop */
    }
  })()

  async function getMediaData(slideIndex: number, sourceId: string) {
    const r = await request('getMediaBytes', slideIndex, sourceId)
    if (!r) return null
    const key = `${slideIndex}|${sourceId}`
    let url = mediaUrls.get(key)
    if (!url) {
      url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime }))
      mediaUrls.set(key, url)
    }
    return { kind: r.kind, dataUrl: url }
  }

  const slidesApi: Partial<SlidesApi> & BridgeObject = {
    capabilities: Object.freeze({ platform: 'web', presenterWindow: true }),
    getLanguage: (() => request('getLanguage')) as SlidesApi['getLanguage'],
    // slide content only: the audience window never themes (main.tsx)
    getTheme: async () => 'system',
    getRenderSlides: async () => {
      await fontsReady
      return (await request('getRenderSlides')) as RenderSlide[]
    },
    getTransition: (i) => request('getTransition', i),
    getAnimations: (i) => request('getAnimations', i),
    getShapeKeys: (i) => request('getShapeKeys', i),
    getMediaData,
    audienceReady: () => request('audienceReady'),
    audienceNav: (action: AudienceNavAction) => send({ t: 'nav', action }),
    onShowSync: (h) => {
      syncHandlers.add(h)
      return () => syncHandlers.delete(h)
    },
    onShowInk: (h) => {
      inkHandlers.add(h)
      return () => inkHandlers.delete(h)
    },
    onDeckChanged: (h) => {
      deckHandlers.add(h)
      return () => deckHandlers.delete(h)
    },
  }

  return {
    // every other member is the safe no-op of safeApi: the audience renders, never edits
    slidesApi: safeApi(slidesApi) as unknown as SlidesApi,
    /** for tests */
    connected: () => port != null,
    isClosed: () => closed,
  }
}

/** install window.slidesApi of an audience window (./install.ts, ?mode=audience) */
export function installAudienceBridge(show: string): ReturnType<typeof createAudienceBridge> {
  const bridge = createAudienceBridge({ show })
  const target = window as unknown as Record<string, unknown>
  target.slidesApi = bridge.slidesApi
  target.__officeWebModule = 'slides'
  target.__officeAudience = AUDIENCE_NS
  return bridge
}
