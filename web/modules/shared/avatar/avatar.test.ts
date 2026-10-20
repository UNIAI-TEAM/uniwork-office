// Frame avatar loader (UNI-1986): same-origin fetch of the host-rewritten avatar path with the frame
// token, `blob:` URL cache (LRU, revoke), in-flight dedupe, 404 memo, parallelism cap.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AVATAR_CACHE_MAX,
  AVATAR_MAX_BYTES,
  AVATAR_MAX_PARALLEL,
  AVATAR_NOT_FOUND_TTL_MS,
  createAvatarLoader,
  isAvatarPath,
} from './loader'

const ORIGIN = 'https://app.test'
const U1 = '01HZZZZZZZZZZZZZZZZZZZZZZ1'
const path = (n: number | string) =>
  `/api/v1/office-frame/documents/01HDOC00000000000000000000/avatars/${String(n).padStart(26, 'U')}`
const P1 = `/api/v1/office-frame/documents/01HDOC00000000000000000000/avatars/${U1}`

interface Call {
  url: string
  init: RequestInit
}

const png = (size = 8, type = 'image/png'): Response =>
  new Response(new Uint8Array(size), { status: 200, headers: { 'content-type': type } })

let created: string[]
let revoked: string[]
let calls: Call[]
let signal: AbortSignal

beforeEach(() => {
  created = []
  revoked = []
  calls = []
  signal = new AbortController().signal
  let seq = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const u = `blob:https://app.test/${++seq}`
    created.push(u)
    return u
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => {
    revoked.push(u)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function loaderWith(
  respond: (call: Call) => Response | Promise<Response>,
  over: Partial<Parameters<typeof createAvatarLoader>[0]> = {},
) {
  const getToken = vi.fn(async () => 'tok-1')
  const refreshToken = vi.fn(async () => 'tok-2')
  const loader = createAvatarLoader({
    getToken,
    refreshToken,
    origin: ORIGIN,
    doFetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const call = { url: String(input), init }
      calls.push(call)
      return respond(call)
    }) as typeof fetch,
    ...over,
  })
  return { loader, getToken, refreshToken }
}

describe('isAvatarPath', () => {
  it('accepts only the same-origin avatar route shape', () => {
    expect(isAvatarPath(P1)).toBe(true)
    expect(isAvatarPath('https://x/a.png')).toBe(false)
    expect(isAvatarPath('//evil.test/api/v1/office-frame/documents/a/avatars/b')).toBe(false)
    expect(isAvatarPath('/api/v1/office-frame/documents/a/ai/credentials')).toBe(false)
    expect(isAvatarPath(`${P1}?x=1`)).toBe(false)
    expect(isAvatarPath('')).toBe(false)
  })

  const DOC_ID = '01HDOC00000000000000000000'
  it.each([
    `//evil.test${P1}`,
    `${P1}/../../ai`,
    `/api/v1/office-frame/documents/${DOC_ID}/../avatars/${U1}`,
    `/api/v1/office-frame%2Fdocuments/${DOC_ID}/avatars/${U1}`,
    `${P1}%2F..`,
    `\\evil.test${P1}`,
    `/api/v1/office-frame/documents/${DOC_ID}\\avatars/${U1}`,
    `${P1}?x=1`,
    `${P1}#f`,
    `${P1}\n`,
    `${P1}/`,
    `https://app.test${P1}`,
    `/api/v1/office-frame/documents/${DOC_ID}/ai/credentials`,
    P1.replace('/office-frame/', '/Office-Frame/'),
    `/x${P1.replace('/api/v1', '')}`,
    `/x/office-frame/documents/${DOC_ID}/avatars/${U1}`,
    `/api${P1.replace('/api/v1', '')}`,
    `/api/v1/office-frame/documents/a/avatars/b`,
    `/api/v1/office-frame/documents/${DOC_ID}/avatars/ai`,
    `/api/v1/office-frame/documents/${DOC_ID}/avatars/-${U1.slice(1)}`,
  ])('refuses the trick path %j', (url) => {
    expect(isAvatarPath(url)).toBe(false)
  })
})

describe('createAvatarLoader', () => {
  it('fetches same-origin with the Bearer frame token and no credentials, returns a blob url', async () => {
    const { loader, getToken } = loaderWith(() => png())
    const url = await loader.load(P1, signal)
    expect(url).toBe('blob:https://app.test/1')
    expect(getToken).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${ORIGIN}${P1}`)
    expect(calls[0]!.init.credentials).toBe('omit')
    expect(calls[0]!.init.mode).toBe('same-origin')
    expect(calls[0]!.init.redirect).toBe('error')
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer tok-1')
  })

  it('never sends the token off origin or to another route', async () => {
    const { loader, getToken } = loaderWith(() => png())
    expect(await loader.load('https://evil.test/a.png', signal)).toBeNull()
    expect(await loader.load('//evil.test/x', signal)).toBeNull()
    expect(await loader.load('/api/v1/office-frame/documents/a/ai/credentials', signal)).toBeNull()
    expect(calls).toHaveLength(0)
    expect(getToken).not.toHaveBeenCalled()
  })

  it('retries once after a 401 with a refreshed token', async () => {
    const { loader, refreshToken } = loaderWith((c) =>
      new Headers(c.init.headers).get('authorization') === 'Bearer tok-1'
        ? new Response(null, { status: 401 })
        : png(),
    )
    expect(await loader.load(P1, signal)).toBe('blob:https://app.test/1')
    expect(refreshToken).toHaveBeenCalledWith('unauthorized')
    expect(calls).toHaveLength(2)
    expect(new Headers(calls[1]!.init.headers).get('authorization')).toBe('Bearer tok-2')
  })

  it('a second 401 gives up with null (no third attempt)', async () => {
    const { loader } = loaderWith(() => new Response(null, { status: 401 }))
    expect(await loader.load(P1, signal)).toBeNull()
    expect(calls).toHaveLength(2)
  })

  it.each(['image/svg+xml', 'text/html', 'application/octet-stream', ''])(
    'rejects content-type %j',
    async (type) => {
      const { loader } = loaderWith(() => png(8, type))
      expect(await loader.load(P1, signal)).toBeNull()
      expect(created).toHaveLength(0)
    },
  )

  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'IMAGE/PNG; charset=binary'])(
    'accepts content-type %s',
    async (type) => {
      const { loader } = loaderWith(() => png(8, type))
      expect(await loader.load(P1, signal)).toMatch(/^blob:/)
    },
  )

  it('rejects a body over 2 MiB and accepts exactly 2 MiB', async () => {
    expect(AVATAR_MAX_BYTES).toBe(2 * 1024 * 1024)
    const big = loaderWith(() => png(AVATAR_MAX_BYTES + 1))
    expect(await big.loader.load(P1, signal)).toBeNull()
    expect(created).toHaveLength(0)
    const edge = loaderWith(() => png(AVATAR_MAX_BYTES))
    expect(await edge.loader.load(P1, signal)).toMatch(/^blob:/)
  })

  it('serves a repeat from the cache and dedupes in-flight requests', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { loader } = loaderWith(async () => {
      await gate
      return png()
    })
    const a = loader.load(P1, signal)
    const b = loader.load(P1, signal)
    release()
    expect(await a).toBe(await b)
    expect(calls).toHaveLength(1)
    expect(await loader.load(P1, signal)).toBe('blob:https://app.test/1')
    expect(calls).toHaveLength(1)
    expect(created).toHaveLength(1)
  })

  it('keeps at most 64 blob urls: the least recently used is revoked', async () => {
    expect(AVATAR_CACHE_MAX).toBe(64)
    const { loader } = loaderWith(() => png())
    for (let i = 0; i < AVATAR_CACHE_MAX; i++) await loader.load(path(i), signal)
    expect(revoked).toHaveLength(0)
    // touch entry 0 so entry 1 is the oldest
    await loader.load(path(0), signal)
    await loader.load(path(AVATAR_CACHE_MAX), signal)
    expect(revoked).toEqual(['blob:https://app.test/2'])
    // the evicted one is fetched again, the touched one is not
    const before = calls.length
    await loader.load(path(0), signal)
    expect(calls).toHaveLength(before)
    await loader.load(path(1), signal)
    expect(calls).toHaveLength(before + 1)
  })

  it('dispose revokes every blob url; the loader stays usable afterwards', async () => {
    const { loader } = loaderWith(() => png())
    await loader.load(path(1), signal)
    await loader.load(path(2), signal)
    loader.dispose()
    expect(revoked.sort()).toEqual(['blob:https://app.test/1', 'blob:https://app.test/2'])
    expect(await loader.load(path(1), signal)).toBe('blob:https://app.test/3')
  })

  it('a fetch that lands after dispose creates no blob url', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { loader } = loaderWith(async () => {
      await gate
      return png()
    })
    const pending = loader.load(P1, signal)
    await Promise.resolve()
    loader.dispose()
    release()
    expect(await pending).toBeNull()
    expect(created).toHaveLength(0)
  })

  it('remembers a 404 for five minutes, then asks again', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'))
    let status = 404
    const { loader } = loaderWith(() => (status === 404 ? new Response(null, { status }) : png()))
    expect(await loader.load(P1, signal)).toBeNull()
    expect(await loader.load(P1, signal)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(AVATAR_NOT_FOUND_TTL_MS).toBe(5 * 60 * 1000)
    status = 200
    vi.setSystemTime(new Date('2026-10-20T00:04:59Z'))
    expect(await loader.load(P1, signal)).toBeNull()
    expect(calls).toHaveLength(1)
    vi.setSystemTime(new Date('2026-10-20T00:05:01Z'))
    expect(await loader.load(P1, signal)).toMatch(/^blob:/)
    expect(calls).toHaveLength(2)
  })

  it('does not remember other failures (5xx, network)', async () => {
    let n = 0
    const { loader } = loaderWith(() => {
      n++
      if (n === 1) return new Response(null, { status: 503 })
      if (n === 2) throw new TypeError('offline')
      return png()
    })
    expect(await loader.load(P1, signal)).toBeNull()
    expect(await loader.load(P1, signal)).toBeNull()
    expect(await loader.load(P1, signal)).toMatch(/^blob:/)
    expect(calls).toHaveLength(3)
  })

  it('runs at most four requests at a time', async () => {
    let live = 0
    let peak = 0
    const releases: Array<() => void> = []
    const { loader } = loaderWith(async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise<void>((r) => releases.push(r))
      live--
      return png()
    })
    expect(AVATAR_MAX_PARALLEL).toBe(4)
    const all = Array.from({ length: 10 }, (_, i) => loader.load(path(i), signal))
    for (let i = 0; i < 10; i++) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(i))
      releases[i]!()
    }
    const out = await Promise.all(all)
    expect(out.every((u) => u?.startsWith('blob:'))).toBe(true)
    expect(peak).toBe(4)
  })

  it('an aborted caller gets null and the shared request still fills the cache', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { loader } = loaderWith(async () => {
      await gate
      return png()
    })
    const ac = new AbortController()
    const first = loader.load(P1, ac.signal)
    ac.abort()
    expect(await first).toBeNull()
    release()
    await vi.waitFor(() => expect(created).toHaveLength(1))
    expect(await loader.load(P1, signal)).toBe('blob:https://app.test/1')
    expect(calls).toHaveLength(1)
  })
})
