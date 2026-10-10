// @vitest-environment jsdom
// UNI-1232 A1 (frame side of CONTRACT A1): relative pictures and sibling files of a Markdown/HTML
// document through OpenPayload.assets.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockPort } from '../../docs/bridge/testing/mock-port'
import { createAssetStore } from './assets'

const bytes = (...b: number[]) => new Uint8Array(b)

function store(canUpload = true) {
  const mock = createMockPort()
  return {
    mock,
    store: createAssetStore(mock.port, { fileId: () => 'f1', canUpload: () => canUpload }),
  }
}

/** a fetch that answers per URL: a status, or a body with a content type */
function stubFetch(
  routes: Record<string, number | { body: BodyInit; type: string }>,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const route = routes[url]
    if (route === undefined) throw new TypeError('network down')
    if (typeof route === 'number') return new Response(null, { status: route })
    return new Response(init?.method === 'HEAD' ? null : route.body, {
      headers: { 'content-type': route.type },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolver: keys exactly as written', () => {
  it('finds a path under the spelling the document uses, with or without ./, decoded, without ?query', () => {
    const { store: s } = store()
    s.reset({
      './assets/a.png': '/u/a',
      'my pic.webp': '/u/b',
      '../shared/logo.svg': '/u/c',
    })
    expect(s.resolve('./assets/a.png')).toBe('/u/a')
    expect(s.resolve('assets/a.png')).toBe('/u/a')
    expect(s.resolve('my%20pic.webp')).toBe('/u/b')
    expect(s.resolve('my pic.webp?v=2#x')).toBe('/u/b')
    expect(s.resolve('../shared/logo.svg')).toBe('/u/c')
    expect(s.resolve('assets/other.png')).toBeNull()
    expect(s.resolve('https://remote.example/a.png')).toBeNull()
  })

  it('unresolve returns the spelling of the document, per URL', () => {
    const { store: s } = store()
    s.reset({ './a.png': '/u/1', 'a.png': '/u/2' })
    expect(s.unresolve('/u/1')).toBe('./a.png')
    expect(s.unresolve('/u/2')).toBe('a.png')
  })
})

describe('WebP and SVG pictures', () => {
  it('reads a mapped WebP and SVG with their own types', async () => {
    const { store: s } = store()
    s.reset({ 'a.webp': '/u/w', 'b.svg': '/u/s' })
    const fetchMock = stubFetch({
      '/u/w': { body: bytes(1, 2, 3), type: 'image/webp' },
      '/u/s': { body: '<svg xmlns="http://www.w3.org/2000/svg"/>', type: 'image/svg+xml' },
    })
    expect(await s.read('a.webp')).toEqual({ mime: 'image/webp', base64: 'AQID' })
    const svg = await s.read('b.svg')
    expect(svg?.mime).toBe('image/svg+xml')
    expect(atob(svg!.base64)).toContain('<svg')
    // same origin, no cookies
    expect(fetchMock).toHaveBeenCalledWith('/u/w', { credentials: 'omit' })
  })

  it('falls back to the file extension when the server sends a generic type', async () => {
    const { store: s } = store()
    s.reset({ 'a.webp': '/u/w?sig=1' })
    stubFetch({ '/u/w?sig=1': { body: bytes(9), type: 'application/octet-stream' } })
    expect((await s.read('a.webp'))?.mime).toBe('image/webp')
  })

  it('decodes WebP and SVG data: URIs locally (base64 and percent-encoded SVG)', async () => {
    const { store: s } = store()
    expect(await s.read('data:image/webp;base64,AQID')).toEqual({
      mime: 'image/webp',
      base64: 'AQID',
    })
    const svg = await s.read('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22x%22%2F%3E')
    expect(svg?.mime).toBe('image/svg+xml')
    expect(atob(svg!.base64)).toBe('<svg xmlns="x"/>')
  })

  it('uploads a WebP as a document asset; an SVG stays a data: URI and is never uploaded', async () => {
    const { mock, store: s } = store()
    const webp = await s.store(bytes(0x52, 0x49, 0x46, 0x46), 'webp')
    expect(webp).toMatch(/^assets\/image-\d{8}-\d{6}-[a-z0-9]+\.webp$/)
    const upload = mock.calls.find((c) => c.type === 'api.images.upload')!
    expect(upload.payload).toMatchObject({ fileId: 'f1', mimeType: 'image/webp' })
    expect((upload.payload as { name: string }).name).toBe(webp!.replace('assets/', ''))
    expect(s.resolve(webp!)).toBe('/img/i1')

    const before = mock.calls.length
    expect(await s.store(bytes(0x3c, 0x73), 'svg')).toBe('data:image/svg+xml;base64,PHM=')
    expect(mock.calls.length).toBe(before)
  })
})

describe('a mapped URL the host refuses counts as missing', () => {
  it('drops 401, 403, 404 and 410 answers; keeps served, unreachable and unsupported-HEAD ones', async () => {
    const { store: s } = store()
    s.reset({
      './ok.png': '/u/ok',
      './revoked.png': '/u/revoked',
      'expired.webp': '/u/expired',
      'gone.gif': '/u/gone',
      'old.svg': '/u/old',
      'offline.png': '/u/offline',
      'nohead.png': '/u/nohead',
    })
    const fetchMock = stubFetch({
      '/u/ok': 200,
      '/u/revoked': 403,
      '/u/expired': 401,
      '/u/gone': 404,
      '/u/old': 410,
      '/u/nohead': 405,
    })
    const dropped = await s.verify()
    expect(dropped.sort()).toEqual(
      ['./revoked.png', 'expired.webp', 'gone.gif', 'old.svg', 'revoked.png'].sort(),
    )
    expect(s.resolve('revoked.png')).toBeNull()
    expect(s.resolve('./revoked.png')).toBeNull()
    // a picture still showing the dropped URL maps back to its authored path (A1b: the renderer redraws it)
    expect(s.unresolve('/u/revoked')).toBe('./revoked.png')
    expect(s.resolve('expired.webp')).toBeNull()
    expect(s.resolve('ok.png')).toBe('/u/ok')
    expect(s.resolve('offline.png')).toBe('/u/offline')
    expect(s.resolve('nohead.png')).toBe('/u/nohead')
    // one HEAD per distinct URL, same origin, no cookies
    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(fetchMock).toHaveBeenCalledWith('/u/revoked', { method: 'HEAD', credentials: 'omit' })
  })

  it('stops waiting for a host that does not answer and keeps the map as it is', async () => {
    vi.useFakeTimers()
    try {
      const { store: s } = store()
      s.reset({ 'a.png': '/u/a' })
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => {})),
      )
      const done = s.verify()
      await vi.advanceTimersByTimeAsync(4_000)
      expect(await done).toEqual([])
      expect(s.resolve('a.png')).toBe('/u/a')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a refused picture is not read for export either', async () => {
    const { store: s } = store()
    s.reset({ 'a.png': '/u/a' })
    stubFetch({ '/u/a': 403 })
    expect(await s.read('a.png')).toBeNull()
  })
})

describe('sibling files for the HTML preview', () => {
  it('reads the text of a mapped stylesheet or script, null when refused or too large', async () => {
    const { store: s } = store()
    s.reset({ 'style.css': '/u/css', 'app.js': '/u/js', 'big.js': '/u/big', 'gone.css': '/u/gone' })
    stubFetch({
      '/u/css': { body: 'body{color:red}', type: 'text/css' },
      '/u/js': { body: 'window.x=1', type: 'text/javascript' },
      '/u/big': { body: 'a'.repeat(2 * 1024 * 1024 + 1), type: 'text/javascript' },
      '/u/gone': 403,
    })
    expect(await s.readText('style.css')).toBe('body{color:red}')
    expect(await s.readText('app.js')).toBe('window.x=1')
    expect(await s.readText('big.js')).toBeNull()
    expect(await s.readText('gone.css')).toBeNull()
    expect(await s.readText('unmapped.css')).toBeNull()
  })
})
