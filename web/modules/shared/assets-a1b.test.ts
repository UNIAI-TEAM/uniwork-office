// @vitest-environment jsdom
// UNI-1232 A1b (frame side of CONTRACT A1b): fresh URLs and paths typed after the open through
// `api.assets.resolve`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockPort, protocolError } from '../../docs/bridge/testing/mock-port'
import { createAssetStore } from './assets'

type Resolve = (payload: { fileId?: string; paths: string[] }) => Record<string, string>

function setup(answer?: Resolve, opts: { refreshAfterMs?: number } = {}) {
  const mock = createMockPort()
  const asked: Array<{ fileId?: string; paths: string[] }> = []
  if (answer) {
    mock.override('api.assets.resolve', (payload) => {
      asked.push(payload as { fileId?: string; paths: string[] })
      return { assets: answer(payload as { fileId?: string; paths: string[] }) }
    })
  }
  const onChange = vi.fn()
  const store = createAssetStore(mock.port, {
    fileId: () => 'f1',
    canUpload: () => false,
    onChange,
    ...opts,
  })
  return { mock, store, asked, onChange }
}

const resolveCalls = (mock: ReturnType<typeof createMockPort>) =>
  mock.calls.filter((c) => c.type === 'api.assets.resolve')

/** a fetch that answers HEAD per URL with a status */
function stubHead(status: Record<string, number>) {
  const fn = vi.fn(async (url: string) => new Response(null, { status: status[url] ?? 200 }))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('(a) a path typed after the open', () => {
  it('asks once the user has edited, after typing settles, and learns the answer', async () => {
    const { store, asked, onChange } = setup((p) =>
      Object.fromEntries(p.paths.map((x) => [x, `/frame/${x}?sig=1`])),
    )
    store.reset({ 'assets/a.png': '/u/a' })
    store.arm()
    expect(store.resolve('./new.png')).toBeNull()
    expect(asked).toHaveLength(0) // debounced
    await vi.advanceTimersByTimeAsync(700)
    expect(asked).toEqual([{ fileId: 'f1', paths: ['./new.png'] }])
    expect(store.resolve('./new.png')).toBe('/frame/./new.png?sig=1')
    expect(onChange).toHaveBeenCalledTimes(1)
    // the document keeps the authored spelling
    expect(store.unresolve('/frame/./new.png?sig=1')).toBe('./new.png')
  })

  it('does not ask for paths met before the first edit (that is the open answer) nor ask twice', async () => {
    const { store, mock } = setup(() => ({}))
    store.reset({})
    expect(store.resolve('assets/gone.png')).toBeNull() // while the document renders
    store.arm()
    expect(store.resolve('assets/gone.png')).toBeNull()
    expect(store.resolve('assets/typed.png')).toBeNull()
    expect(store.resolve('assets/typed.png')).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    // gone.png was already asked-about (met at open); typed.png once
    expect(resolveCalls(mock).map((c) => c.payload)).toEqual([
      { fileId: 'f1', paths: ['assets/typed.png'] },
    ])
  })

  it('only asks for something a document can show: URLs, absolute paths and bare words stay local', async () => {
    const { store, mock } = setup(() => ({}))
    store.reset({})
    store.arm()
    for (const src of [
      'https://x.test/a.png',
      'data:image/png;base64,AAAA',
      '/abs/a.png',
      '#top',
      'btn-primary',
      'index.html',
      '',
    ]) {
      store.resolve(src)
    }
    store.resolve('img/ok.webp')
    store.resolve('css/site.css')
    store.resolve('js/app.mjs')
    await vi.advanceTimersByTimeAsync(2000)
    expect(resolveCalls(mock)).toHaveLength(1)
    expect((resolveCalls(mock)[0]!.payload as { paths: string[] }).paths).toEqual([
      'img/ok.webp',
      'css/site.css',
      'js/app.mjs',
    ])
  })

  it('sends at most 50 paths per request and keeps the rest for the next', async () => {
    const { store, asked } = setup(() => ({}))
    store.reset({})
    store.arm()
    for (let i = 0; i < 70; i++) store.resolve(`p${i}.png`)
    await vi.advanceTimersByTimeAsync(5000)
    expect(asked.map((a) => a.paths.length)).toEqual([50, 20])
  })

  it('a path the host cannot serve stays missing, and is not asked again', async () => {
    const { store, asked, onChange } = setup(() => ({}))
    store.reset({})
    store.arm()
    store.resolve('nope.png')
    await vi.advanceTimersByTimeAsync(700)
    expect(store.resolve('nope.png')).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(asked).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('an old host answers unsupported: nothing is asked again this session, even for a new document', async () => {
    const { store, mock } = setup()
    mock.override('api.assets.resolve', () => Promise.reject(protocolError('unsupported')))
    store.reset({})
    store.arm()
    store.resolve('a.png')
    await vi.advanceTimersByTimeAsync(700)
    store.resolve('b.png')
    store.reset({})
    store.arm()
    store.resolve('c.png')
    await vi.advanceTimersByTimeAsync(5000)
    expect(resolveCalls(mock)).toHaveLength(1)
  })

  it('an answer for a document that was replaced meanwhile is dropped', async () => {
    const { store, mock } = setup()
    let release!: () => void
    mock.override(
      'api.assets.resolve',
      () =>
        new Promise((resolve) => {
          release = () => resolve({ assets: { 'old.png': '/stale/old.png' } })
        }),
    )
    store.reset({})
    store.arm()
    store.resolve('old.png')
    await vi.advanceTimersByTimeAsync(700)
    store.reset({}) // the user opened another document
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(store.resolve('old.png')).toBeNull()
  })
})

describe('(b) fresh URLs before the open answer expires', () => {
  it('asks for every mapped path (as written) at ~50 min, swaps the URLs and tells the renderer', async () => {
    const { store, asked, onChange } = setup((p) =>
      Object.fromEntries(p.paths.map((x) => [x, `/u/${x}?sig=2`])),
    )
    store.reset({ 'assets/a.png': '/u/a1', './assets/b.webp': '/u/b1' })
    await vi.advanceTimersByTimeAsync(49 * 60_000)
    expect(asked).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(asked).toHaveLength(1)
    expect(new Set(asked[0]!.paths)).toEqual(new Set(['assets/a.png', './assets/b.webp']))
    expect(store.resolve('assets/a.png')).toBe('/u/assets/a.png?sig=2')
    // the normalised spelling follows
    expect(store.resolve('assets/b.webp')).toBe('/u/./assets/b.webp?sig=2')
    expect(store.unresolve('/u/assets/a.png?sig=2')).toBe('assets/a.png')
    expect(onChange).toHaveBeenCalledTimes(1)
    // and again an hour on
    await vi.advanceTimersByTimeAsync(51 * 60_000)
    expect(asked).toHaveLength(2)
  })

  it('a path the host no longer serves becomes missing; a failed refresh is retried in 5 minutes', async () => {
    const { store, mock, onChange } = setup()
    let fail = true
    mock.override('api.assets.resolve', () =>
      fail ? Promise.reject(new Error('offline')) : { assets: { 'assets/keep.png': '/u/keep2' } },
    )
    store.reset({ 'assets/keep.png': '/u/keep1', 'assets/lost.png': '/u/lost1' })
    await vi.advanceTimersByTimeAsync(51 * 60_000)
    expect(store.resolve('assets/keep.png')).toBe('/u/keep1') // kept as is
    expect(onChange).not.toHaveBeenCalled()
    fail = false
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 100)
    expect(store.resolve('assets/keep.png')).toBe('/u/keep2')
    expect(store.resolve('assets/lost.png')).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('chunks more than 50 paths and an old host leaves every URL alone', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [`a/${i}.png`, `/u/${i}`]),
    )
    const first = setup((p) => Object.fromEntries(p.paths.map((x) => [x, `/n/${x}`])))
    first.store.reset(many)
    await vi.advanceTimersByTimeAsync(51 * 60_000)
    expect(first.asked.map((a) => a.paths.length)).toEqual([50, 50, 20])

    const old = setup()
    old.mock.override('api.assets.resolve', () => Promise.reject(protocolError('unsupported')))
    old.store.reset({ 'assets/a.png': '/u/a1' })
    await vi.advanceTimersByTimeAsync(51 * 60_000)
    expect(old.store.resolve('assets/a.png')).toBe('/u/a1')
    await vi.advanceTimersByTimeAsync(120 * 60_000)
    expect(resolveCalls(old.mock)).toHaveLength(1)
  })
})

describe('(c) a mapped URL refused mid-session', () => {
  it('401/403: asks for a fresh URL once and swaps it', async () => {
    const { store, asked, onChange } = setup(() => ({ 'assets/a.png': '/u/a2' }))
    stubHead({ '/u/a1': 403 })
    store.reset({ 'assets/a.png': '/u/a1' })
    await store.imageFailed('/u/a1')
    expect(asked).toEqual([{ fileId: 'f1', paths: ['assets/a.png'] }])
    expect(store.resolve('assets/a.png')).toBe('/u/a2')
    expect(store.unresolve('/u/a2')).toBe('assets/a.png')
    // an image still showing the old URL maps back to its authored path
    expect(store.unresolve('/u/a1')).toBe('assets/a.png')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('the retry URL refused as well: the picture becomes missing (no second request)', async () => {
    const { store, asked, onChange } = setup(() => ({ 'assets/a.png': '/u/a2' }))
    stubHead({ '/u/a1': 401, '/u/a2': 403 })
    store.reset({ 'assets/a.png': '/u/a1' })
    await store.imageFailed('/u/a1')
    await store.imageFailed('/u/a2')
    expect(asked).toHaveLength(1)
    expect(store.resolve('assets/a.png')).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('the host answers without the path: missing at once', async () => {
    const { store, onChange } = setup(() => ({}))
    stubHead({ '/u/a1': 403 })
    store.reset({ 'assets/a.png': '/u/a1' })
    await store.imageFailed('/u/a1')
    expect(store.resolve('assets/a.png')).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('an image that failed for another reason (the HEAD says it is served) is left alone', async () => {
    const { store, mock, onChange } = setup(() => ({ 'assets/a.png': '/u/a2' }))
    stubHead({ '/u/a1': 200 })
    store.reset({ 'assets/a.png': '/u/a1' })
    await store.imageFailed('/u/a1')
    expect(resolveCalls(mock)).toHaveLength(0)
    expect(store.resolve('assets/a.png')).toBe('/u/a1')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a URL that is not one of ours, an old host and a failing call keep everything as is', async () => {
    const { store, mock, onChange } = setup()
    stubHead({ '/u/a1': 403 })
    store.reset({ 'assets/a.png': '/u/a1' })
    await store.imageFailed('https://elsewhere.test/x.png')
    expect(resolveCalls(mock)).toHaveLength(0)

    mock.override('api.assets.resolve', () => Promise.reject(new Error('offline')))
    await store.imageFailed('/u/a1')
    expect(store.resolve('assets/a.png')).toBe('/u/a1')

    mock.override('api.assets.resolve', () => Promise.reject(protocolError('unsupported')))
    await store.imageFailed('/u/a1')
    expect(store.resolve('assets/a.png')).toBe('/u/a1')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('matches an absolute URL against a relative mapped one (img.src is always absolute)', async () => {
    const { store } = setup(() => ({ 'assets/a.png': '/u/a2' }))
    stubHead({ '/u/a1': 403 })
    store.reset({ 'assets/a.png': '/u/a1' })
    await store.imageFailed(new URL('/u/a1', location.href).href)
    expect(store.resolve('assets/a.png')).toBe('/u/a2')
  })
})
