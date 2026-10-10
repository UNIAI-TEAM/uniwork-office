/**
 * The presenter <-> audience sync protocol of the web presenter view (SP1, UNI-1015): message
 * validation, the window.open + MessagePort handshake, state / ink / navigation forwarding, the
 * read-only deck queries, both ways of closing, and the Window Management placement (granted,
 * denied, unsupported). The windows are fakes; the ports are real MessageChannels.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShowSyncState } from '../../../apps/slides/src/shared/ipc'
import { createAudienceBridge } from './audience-bridge'
import {
  AUDIENCE_METHODS,
  audienceShowId,
  audienceUrl,
  handshake,
  parseHandshake,
  parseInkEvent,
  parseSyncState,
  parseToAudience,
  parseToPresenter,
} from './presenter-protocol'
import { createPresenterWindow, type AudienceSource } from './presenter-window'
import {
  createScreenPlacer,
  pickScreen,
  popupFeatures,
  type ScreenDetailsLike,
  type ScreenLike,
} from './screens'

const ORIGIN = 'https://uniwork.test'
const FRAME = `${ORIGIN}/office-frame/slides/1.0.0-abc/index.html`
const SHOW = '0123456789abcdef0123456789abcdef'

const STATE: ShowSyncState = {
  idx: 2,
  played: 1,
  playing: true,
  fresh: true,
  ended: false,
  black: false,
  white: false,
}

// jsdom has no blob: URLs
if (typeof URL.createObjectURL !== 'function') {
  let n = 0
  URL.createObjectURL = () => `blob:${ORIGIN}/${++n}`
  URL.revokeObjectURL = () => {}
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out')
    await tick(5)
  }
}

describe('protocol validation', () => {
  it('accepts well-formed sync states and rejects malformed ones', () => {
    expect(parseSyncState(STATE)).toEqual(STATE)
    const { white: _w, ...older } = STATE
    expect(parseSyncState(older)).toEqual(older)
    expect(parseSyncState({ ...STATE, idx: -1 })).toBeNull()
    expect(parseSyncState({ ...STATE, idx: 1.5 })).toBeNull()
    expect(parseSyncState({ ...STATE, black: 'yes' })).toBeNull()
    expect(parseSyncState({ ...STATE, white: 1 })).toBeNull()
    expect(parseSyncState(null)).toBeNull()
  })

  it('accepts ink events and rejects malformed ones', () => {
    expect(parseInkEvent({ type: 'clear' })).toEqual({ type: 'clear' })
    expect(parseInkEvent({ type: 'laser', x: -1, y: -1 })).toEqual({ type: 'laser', x: -1, y: -1 })
    expect(parseInkEvent({ type: 'stroke-start', x: 0.1, y: 0.2, color: '#e53935' })).toEqual({
      type: 'stroke-start',
      x: 0.1,
      y: 0.2,
      color: '#e53935',
    })
    expect(parseInkEvent({ type: 'stroke-move', x: Number.NaN, y: 0 })).toBeNull()
    expect(parseInkEvent({ type: 'stroke-start', x: 0, y: 0 })).toBeNull()
    expect(parseInkEvent({ type: 'erase' })).toBeNull()
  })

  it('serves only the read-only audience methods and the three navigation actions', () => {
    for (const method of AUDIENCE_METHODS)
      expect(parseToPresenter({ t: 'req', id: 1, method, args: [] })).not.toBeNull()
    for (const method of ['editText', 'save', 'saveAs', 'deleteSlide', 'constructor', '__proto__'])
      expect(parseToPresenter({ t: 'req', id: 1, method, args: [] })).toBeNull()
    expect(parseToPresenter({ t: 'req', id: 1, method: 'getAnimations', args: 'x' })).toBeNull()
    expect(parseToPresenter({ t: 'req', id: -1, method: 'getAnimations', args: [] })).toBeNull()
    expect(parseToPresenter({ t: 'nav', action: 'next' })).toEqual({ t: 'nav', action: 'next' })
    expect(parseToPresenter({ t: 'nav', action: 'delete' })).toBeNull()
    expect(parseToPresenter({ t: 'bye' })).toEqual({ t: 'bye' })
    expect(parseToPresenter({ t: 'sync', state: STATE })).toBeNull()
  })

  it('validates presenter messages', () => {
    expect(parseToAudience({ t: 'sync', state: STATE })).toEqual({ t: 'sync', state: STATE })
    expect(parseToAudience({ t: 'sync', state: { idx: 'x' } })).toBeNull()
    expect(parseToAudience({ t: 'ink', ev: { type: 'clear' } })).toEqual({
      t: 'ink',
      ev: { type: 'clear' },
    })
    expect(parseToAudience({ t: 'deck', slides: [] })).toEqual({ t: 'deck', slides: [] })
    expect(parseToAudience({ t: 'res', id: 3, ok: true, value: 5 })).toEqual({
      t: 'res',
      id: 3,
      ok: true,
      value: 5,
    })
    expect(parseToAudience({ t: 'res', id: 3, ok: 'maybe' })).toBeNull()
    expect(parseToAudience({ t: 'end' })).toEqual({ t: 'end' })
    expect(parseToAudience({ t: 'nav', action: 'next' })).toBeNull()
  })

  it('checks the handshake namespace, version and show id', () => {
    expect(parseHandshake(handshake('hello', SHOW))).toEqual(handshake('hello', SHOW))
    expect(parseHandshake({ ...handshake('hello', SHOW), ns: 'uniwork.office.docs' })).toBeNull()
    expect(parseHandshake({ ...handshake('hello', SHOW), v: 2 })).toBeNull()
    expect(parseHandshake(handshake('hello', 'short'))).toBeNull()
    expect(parseHandshake({ ...handshake('hello', SHOW), t: 'connectx' })).toBeNull()
  })

  it('builds the audience URL from the frame page and reads it back', () => {
    const url = audienceUrl(`${FRAME}?x=1#h`, SHOW)
    expect(url).toBe(`${FRAME}?mode=audience&show=${SHOW}`)
    expect(audienceShowId(new URL(url).search)).toBe(SHOW)
    expect(audienceShowId('?mode=audience')).toBeNull()
    expect(audienceShowId(`?show=${SHOW}`)).toBeNull()
    expect(audienceShowId('?mode=audience&show=../x')).toBeNull()
  })
})

// ---------------------------------------------------------------- fake windows

type Listener = (e: Event) => void

class FakeWindow {
  readonly listeners = new Map<string, Set<Listener>>()
  closed = false
  opener: FakeWindow | null = null
  focused = 0
  moves: Array<[string, number, number]> = []
  constructor(public location: { href: string; origin: string }) {}
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn)
  }
  dispatch(type: string, props: Record<string, unknown> = {}) {
    const e = Object.assign(new Event(type), props)
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e)
  }
  /** `this.postMessage(data)` as called by `from` */
  receive(from: FakeWindow, data: unknown, targetOrigin: string, ports: MessagePort[] = []) {
    if (targetOrigin !== this.location.origin) return
    setTimeout(
      () => this.dispatch('message', { data, origin: from.location.origin, source: from, ports }),
      0,
    )
  }
  focus() {
    this.focused++
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.dispatch('pagehide')
  }
  moveTo(x: number, y: number) {
    this.moves.push(['move', x, y])
  }
  resizeTo(w: number, h: number) {
    this.moves.push(['size', w, h])
  }
  get document() {
    return document
  }
}

function source(over: Partial<AudienceSource> = {}): AudienceSource {
  return {
    getRenderSlides: vi.fn(async () => [{ widthPx: 960, heightPx: 540, nodes: [] }] as never),
    getTransition: vi.fn(async (i: number) => (i === 1 ? 'fade' : 'none')),
    getAnimations: vi.fn(async () => []),
    getShapeKeys: vi.fn(async () => []),
    getMediaBytes: vi.fn(async () => ({
      kind: 'audio' as const,
      mime: 'audio/mpeg',
      bytes: new Uint8Array([1, 2, 3]).buffer,
    })),
    getEmbeddedFonts: vi.fn(async () => []),
    getLanguage: vi.fn(async () => 'vi'),
    ...over,
  }
}

interface Rig {
  presenterWin: FakeWindow
  audienceWin: FakeWindow | null
  presenter: ReturnType<typeof createPresenterWindow>
  audience: ReturnType<typeof createAudienceBridge> | null
  opened: Array<{ url: string; name: string; features: string }>
  src: AudienceSource
}

const rigs: Rig[] = []

function rig(
  opts: {
    block?: boolean
    screens?: ReturnType<typeof createScreenPlacer>
    src?: AudienceSource
  } = {},
): Rig {
  const presenterWin = new FakeWindow({ href: FRAME, origin: ORIGIN })
  const r = {} as Rig
  r.presenterWin = presenterWin
  r.audienceWin = null
  r.audience = null
  r.opened = []
  r.src = opts.src ?? source()
  const open = ((url: string, name: string, features: string) => {
    r.opened.push({ url, name, features })
    if (opts.block) return null
    const aw = new FakeWindow({ href: url, origin: ORIGIN })
    aw.opener = presenterWin
    // the windows post to each other
    ;(aw as unknown as { postMessage: unknown }).postMessage = (
      d: unknown,
      o: string,
      p?: MessagePort[],
    ) => aw.receive(presenterWin, d, o, p)
    ;(presenterWin as unknown as { postMessage: unknown }).postMessage = (d: unknown, o: string) =>
      presenterWin.receive(aw, d, o)
    r.audienceWin = aw
    // the audience page boots a moment later
    setTimeout(() => {
      r.audience = createAudienceBridge({
        show: audienceShowId(new URL(url).search)!,
        win: aw as unknown as Window,
        retryMs: 10,
        connectTimeoutMs: 1000,
      })
    }, 5)
    return aw as unknown as Window
  }) as typeof window.open
  r.presenter = createPresenterWindow({
    source: r.src,
    open,
    win: presenterWin as unknown as Window,
    screens: opts.screens ?? createScreenPlacer({} as Window),
    pollMs: 10,
  })
  rigs.push(r)
  return r
}

afterEach(async () => {
  for (const r of rigs.splice(0)) await r.presenter.api.presenterEnd()
})

async function connected(r: Rig): Promise<void> {
  await until(() => r.audience?.connected() === true && r.presenter.audienceOpen())
}

describe('presenter window', () => {
  it('opens the audience page of the same bundle and connects over a private port', async () => {
    const r = rig()
    const changes: boolean[] = []
    r.presenter.api.onPresenterAudience!((open) => changes.push(open))
    expect(await r.presenter.api.presenterStart()).toEqual({ audience: false })
    expect(await r.presenter.api.presenterOpenAudience!()).toEqual({ audience: true })
    expect(r.opened).toHaveLength(1)
    expect(r.opened[0]!.url).toMatch(
      /^https:\/\/uniwork\.test\/office-frame\/slides\/1\.0\.0-abc\/index\.html\?mode=audience&show=[0-9a-f]{32}$/,
    )
    expect(r.opened[0]!.features).toBe('popup,width=960,height=540')
    await connected(r)
    expect(changes).toEqual([true])
    // the audience keeps no handle on the presenter frame (same-origin with the UniWork page)
    expect(r.audienceWin!.opener).toBeNull()
  })

  it('does nothing outside the presenter view', async () => {
    const r = rig()
    expect(await r.presenter.api.presenterOpenAudience!()).toEqual({ audience: false })
    expect(r.opened).toHaveLength(0)
  })

  it('reports a blocked popup', async () => {
    const r = rig({ block: true })
    await r.presenter.api.presenterStart()
    expect(await r.presenter.api.presenterOpenAudience!()).toEqual({
      audience: false,
      blocked: true,
    })
  })

  it('focuses the open window instead of opening a second one', async () => {
    const r = rig()
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await connected(r)
    await r.presenter.api.presenterOpenAudience!()
    expect(r.opened).toHaveLength(1)
    expect(r.audienceWin!.focused).toBe(1)
  })

  it('mirrors slide index, build steps, media play state and black / white screen', async () => {
    const r = rig()
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await connected(r)
    const seen: ShowSyncState[] = []
    r.audience!.slidesApi.onShowSync((s) => seen.push(s))
    const steps: ShowSyncState[] = [
      { ...STATE, idx: 0, played: 0, playing: false },
      { ...STATE, idx: 0, played: 1, playing: true },
      { ...STATE, idx: 1, played: 0, playing: false, fresh: true },
      { ...STATE, idx: 1, black: true },
      { ...STATE, idx: 1, black: false, white: true },
      { ...STATE, idx: 0, fresh: false },
      { ...STATE, ended: true },
    ]
    for (const s of steps) r.presenter.api.presenterSync(s)
    await until(() => seen.length === steps.length)
    expect(seen).toEqual(steps)
  })

  it('forwards ink and deck changes', async () => {
    const r = rig()
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await connected(r)
    const ink: unknown[] = []
    const decks: unknown[] = []
    r.audience!.slidesApi.onShowInk((e) => ink.push(e))
    r.audience!.slidesApi.onDeckChanged((e) => decks.push(e))
    r.presenter.api.presenterInk({ type: 'stroke-start', x: 0.5, y: 0.5, color: '#e53935' })
    r.presenter.api.presenterInk({ type: 'clear' })
    r.presenter.deckChanged([{ widthPx: 960, heightPx: 540 } as never])
    await until(() => ink.length === 2 && decks.length === 1)
    expect(ink[1]).toEqual({ type: 'clear' })
    expect(decks[0]).toMatchObject({ size: { cx: 960, cy: 540 } })
  })

  it('gives a late audience the current state (audienceReady + first sync)', async () => {
    const r = rig()
    await r.presenter.api.presenterStart()
    r.presenter.api.presenterSync(STATE)
    await r.presenter.api.presenterOpenAudience!()
    const seen: ShowSyncState[] = []
    await until(() => r.audience != null)
    r.audience!.slidesApi.onShowSync((s) => seen.push(s))
    expect(await r.audience!.slidesApi.audienceReady()).toEqual(STATE)
    await until(() => seen.length === 1)
    expect(seen[0]).toEqual(STATE)
  })

  it('serves the read-only deck queries and media as bytes', async () => {
    const r = rig()
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    const api = await (async () => {
      await until(() => r.audience != null)
      return r.audience!.slidesApi
    })()
    expect(await api.getLanguage()).toBe('vi')
    expect(await api.getRenderSlides()).toHaveLength(1)
    expect(await api.getTransition(1)).toBe('fade')
    expect(r.src.getTransition).toHaveBeenCalledWith(1)
    expect(await api.getAnimations(0)).toEqual([])
    expect(await api.getShapeKeys(0)).toEqual([])
    const media = await api.getMediaData(0, 'rId3')
    expect(media?.kind).toBe('audio')
    expect(media?.dataUrl).toMatch(/^blob:/)
    expect(r.src.getEmbeddedFonts).toHaveBeenCalledTimes(1)
    // anything else is a no-op on the audience side, never a presenter call
    await expect(api.editText({} as never)).resolves.toBeUndefined()
  })

  it('turns a failing query into a rejection', async () => {
    const r = rig({
      src: source({
        getAnimations: async () => {
          throw new Error('boom')
        },
      }),
    })
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await until(() => r.audience != null)
    await expect(r.audience!.slidesApi.getAnimations(0)).rejects.toThrow('boom')
  })

  it('sends audience clicks and keys back as navigation', async () => {
    const r = rig()
    const nav: string[] = []
    r.presenter.api.onAudienceNav((a) => nav.push(a))
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await connected(r)
    r.audience!.slidesApi.audienceNav('next')
    r.audience!.slidesApi.audienceNav('prev')
    r.audience!.slidesApi.audienceNav('exit')
    await until(() => nav.length === 3)
    expect(nav).toEqual(['next', 'prev', 'exit'])
  })

  it('keeps presenting when the user closes the audience window', async () => {
    const r = rig()
    const changes: boolean[] = []
    r.presenter.api.onPresenterAudience!((open) => changes.push(open))
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await connected(r)
    r.audienceWin!.close()
    await until(() => changes.length === 2)
    expect(changes).toEqual([true, false])
    expect(r.presenter.audienceOpen()).toBe(false)
    // the presenter view keeps driving the show; a new audience window can be opened
    expect(() => r.presenter.api.presenterSync(STATE)).not.toThrow()
    expect(await r.presenter.api.presenterOpenAudience!()).toEqual({ audience: true })
    expect(r.opened).toHaveLength(2)
  })

  it('notices a window closed without its goodbye', async () => {
    const r = rig()
    const changes: boolean[] = []
    r.presenter.api.onPresenterAudience!((open) => changes.push(open))
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await connected(r)
    r.audienceWin!.closed = true
    await until(() => changes.length === 2)
    expect(changes).toEqual([true, false])
  })

  it('closes the audience window when the show ends or the presenter frame goes away', async () => {
    const r = rig()
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await connected(r)
    await r.presenter.api.presenterEnd()
    expect(r.audienceWin!.closed).toBe(true)
    await until(() => r.audience!.isClosed())

    const r2 = rig()
    await r2.presenter.api.presenterStart()
    await r2.presenter.api.presenterOpenAudience!()
    await connected(r2)
    r2.presenterWin.dispatch('pagehide')
    expect(r2.audienceWin!.closed).toBe(true)
  })

  it('closes the audience window and keeps the presenter on presenterCloseAudience', async () => {
    const r = rig()
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await connected(r)
    await r.presenter.api.presenterCloseAudience!()
    expect(r.audienceWin!.closed).toBe(true)
    await until(() => r.audience!.isClosed())
    expect(await r.presenter.api.presenterOpenAudience!()).toEqual({ audience: true })
  })

  it('ignores a hello from another window, origin or show', async () => {
    const r = rig()
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    const intruder = new FakeWindow({ href: `${ORIGIN}/x`, origin: ORIGIN })
    const show = audienceShowId(new URL(r.opened[0]!.url).search)!
    r.presenterWin.dispatch('message', {
      data: handshake('hello', show),
      origin: ORIGIN,
      source: intruder,
    })
    r.presenterWin.dispatch('message', {
      data: handshake('hello', show),
      origin: 'https://evil.test',
      source: r.audienceWin,
    })
    r.presenterWin.dispatch('message', {
      data: handshake('hello', SHOW),
      origin: ORIGIN,
      source: r.audienceWin,
    })
    expect(r.presenter.audienceOpen()).toBe(false)
    await connected(r)
  })

  it('an audience page without a presenter (reloaded, opened by hand) closes itself', async () => {
    const lone = new FakeWindow({ href: `${FRAME}?mode=audience&show=${SHOW}`, origin: ORIGIN })
    const a = createAudienceBridge({ show: SHOW, win: lone as unknown as Window, retryMs: 10 })
    await until(() => a.isClosed())
    expect(lone.closed).toBe(true)
  })
})

// ---------------------------------------------------------------- Window Management

const LAPTOP: ScreenLike = {
  availLeft: 0,
  availTop: 0,
  availWidth: 1440,
  availHeight: 900,
  isPrimary: true,
}
const PROJECTOR: ScreenLike = { availLeft: 1440, availTop: 0, availWidth: 1920, availHeight: 1080 }
const TV: ScreenLike = { availLeft: 3360, availTop: 0, availWidth: 1280, availHeight: 720 }

function placerWith(getScreenDetails?: () => Promise<ScreenDetailsLike>) {
  return createScreenPlacer({ getScreenDetails } as unknown as Window)
}

describe('screen placement', () => {
  it('picks a screen other than the presenter one, cycling on swap', () => {
    const d = { screens: [LAPTOP, PROJECTOR, TV], currentScreen: LAPTOP }
    expect(pickScreen(d)).toBe(PROJECTOR)
    expect(pickScreen(d, PROJECTOR)).toBe(TV)
    expect(pickScreen(d, TV)).toBe(PROJECTOR)
    expect(
      pickScreen({ screens: [LAPTOP, PROJECTOR], currentScreen: LAPTOP }, PROJECTOR),
    ).toBeNull()
    expect(pickScreen({ screens: [LAPTOP], currentScreen: LAPTOP })).toBeNull()
    expect(popupFeatures(PROJECTOR)).toBe('popup,left=1440,top=0,width=1920,height=1080')
  })

  it('granted: moves the audience window onto the projector and opens later ones there', async () => {
    const details = vi.fn(async () => ({ screens: [LAPTOP, PROJECTOR], currentScreen: LAPTOP }))
    const r = rig({ screens: placerWith(details) })
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await until(() => r.audienceWin!.moves.length === 2)
    expect(r.audienceWin!.moves).toEqual([
      ['move', 1440, 0],
      ['size', 1920, 1080],
    ])
    await connected(r)
    await r.presenter.api.presenterCloseAudience!()
    await r.presenter.api.presenterOpenAudience!()
    expect(r.opened[1]!.features).toBe('popup,left=1440,top=0,width=1920,height=1080')
    expect(details).toHaveBeenCalledTimes(1)
  })

  it('granted with three screens: swap moves the audience on to the next screen', async () => {
    const r = rig({
      screens: placerWith(async () => ({
        screens: [LAPTOP, PROJECTOR, TV],
        currentScreen: LAPTOP,
      })),
    })
    await r.presenter.api.presenterStart()
    await r.presenter.api.presenterOpenAudience!()
    await until(() => r.audienceWin!.moves.length === 2)
    expect(await r.presenter.api.presenterSwap()).toBe(true)
    expect(r.audienceWin!.moves.slice(2)).toEqual([
      ['move', 3360, 0],
      ['size', 1280, 720],
    ])
  })

  it('denied: opens at the default size, never asks again, swap is a no-op', async () => {
    const details = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    const r = rig({ screens: placerWith(details) })
    await r.presenter.api.presenterStart()
    expect(await r.presenter.api.presenterOpenAudience!()).toEqual({ audience: true })
    await connected(r)
    expect(r.opened[0]!.features).toBe('popup,width=960,height=540')
    expect(r.audienceWin!.moves).toEqual([])
    expect(await r.presenter.api.presenterSwap()).toBe(false)
    await r.presenter.api.presenterCloseAudience!()
    await r.presenter.api.presenterOpenAudience!()
    expect(details).toHaveBeenCalledTimes(1)
  })

  it('unsupported or single screen: no placement, the user drags the window', async () => {
    const single = rig({
      screens: placerWith(async () => ({ screens: [LAPTOP], currentScreen: LAPTOP })),
    })
    await single.presenter.api.presenterStart()
    await single.presenter.api.presenterOpenAudience!()
    await connected(single)
    expect(single.audienceWin!.moves).toEqual([])
    expect(await single.presenter.api.presenterSwap()).toBe(false)

    const none = rig({ screens: placerWith(undefined) })
    await none.presenter.api.presenterStart()
    expect(await none.presenter.api.presenterOpenAudience!()).toEqual({ audience: true })
    expect(await none.presenter.api.presenterSwap()).toBe(false)
  })
})
