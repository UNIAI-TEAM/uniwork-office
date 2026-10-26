import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import {
  CapabilityCache,
  NEVER_READ_CAPABILITIES,
  parseCapabilities,
  type CapabilityFetch,
  type OfficeCapabilities,
} from '../src/main/uniwork-sync/capability/cache'
import { createCapabilityFetch } from '../src/main/uniwork-sync/capability/client'

const ALL_ON: OfficeCapabilities = {
  sync_feed: true,
  sync_write: true,
  offline_library: true,
  ai_uniwork: true,
  ai_uniwork_formats: ['docx', 'xlsx'],
  drive_connector: true,
}

function fakeClock(start = 5_000_000) {
  let now = start
  return {
    now: () => now,
    advance(ms: number) {
      now += ms
    },
  }
}

/** a scripted capability route: one answer per org per call (`offline` rejects) */
function fakeFetch(answers: Record<string, Array<{ status: number; body?: unknown } | 'offline'>>) {
  return vi.fn<CapabilityFetch>(async (orgId) => {
    const next = answers[orgId]?.shift()
    if (!next || next === 'offline') throw new Error('offline')
    return { status: next.status, body: next.body }
  })
}

const ok = (caps: Partial<OfficeCapabilities> & { ttl_seconds?: number } = {}) => ({
  status: 200,
  body: { ...ALL_ON, ...caps },
})

describe('capability cache', () => {
  it('ttl 0 or missing -> 300 s', async () => {
    for (const ttl of [0, undefined]) {
      const clock = fakeClock()
      const fetch = fakeFetch({ o1: [ok({ ttl_seconds: ttl }), ok({ sync_feed: false })] })
      const cache = new CapabilityCache({ fetch, clock })
      expect(await cache.get('o1')).toEqual({ kind: 'ok', capabilities: ALL_ON, source: 'fresh' })
      clock.advance(299_999)
      expect((await cache.get('o1')).source).toBe('cached')
      expect(fetch).toHaveBeenCalledTimes(1)
      clock.advance(1)
      const read = await cache.get('o1')
      expect(read.source).toBe('fresh')
      expect(read.capabilities.sync_feed).toBe(false)
      expect(fetch).toHaveBeenCalledTimes(2)
    }
  })

  it('honours a server ttl', async () => {
    const clock = fakeClock()
    const fetch = fakeFetch({ o1: [ok({ ttl_seconds: 60 }), ok()] })
    const cache = new CapabilityCache({ fetch, clock })
    await cache.get('o1')
    clock.advance(60_000)
    await cache.get('o1')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('500 within the TTL keeps the value as is', async () => {
    const clock = fakeClock()
    const fetch = fakeFetch({ o1: [ok(), { status: 500, body: { error: { code: 'internal' } } }] })
    const cache = new CapabilityCache({ fetch, clock })
    await cache.get('o1')
    clock.advance(10_000)
    expect(await cache.get('o1', { force: true })).toEqual({
      kind: 'ok',
      capabilities: ALL_ON,
      source: 'cached',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([{ status: 500 }, 'offline' as const, { status: 200, body: { sync_feed: 'yes' } }])(
    'after the TTL a failed read (%j) keeps the last G5 capabilities, ai_uniwork off',
    async (failure) => {
      const clock = fakeClock()
      const fetch = fakeFetch({ o1: [ok({ sync_feed: true, offline_library: false }), failure] })
      const cache = new CapabilityCache({ fetch, clock })
      await cache.get('o1')
      clock.advance(300_000)
      expect(await cache.get('o1')).toEqual({
        kind: 'ok',
        capabilities: {
          sync_feed: true,
          sync_write: true,
          offline_library: false,
          ai_uniwork: false,
          ai_uniwork_formats: [],
          drive_connector: false,
        },
        source: 'stale',
      })
    },
  )

  it('never read -> write on, feed / library / AI off', async () => {
    const cache = new CapabilityCache({
      fetch: fakeFetch({ o1: [{ status: 500 }, 'offline'] }),
      clock: fakeClock(),
    })
    for (let i = 0; i < 2; i += 1) {
      expect(await cache.get('o1')).toEqual({
        kind: 'ok',
        capabilities: NEVER_READ_CAPABILITIES,
        source: 'default',
      })
    }
    expect(NEVER_READ_CAPABILITIES).toEqual({
      sync_feed: false,
      sync_write: true,
      offline_library: false,
      ai_uniwork: false,
      ai_uniwork_formats: [],
      drive_connector: false,
    })
  })

  it('org A never applies to org B', async () => {
    const fetch = fakeFetch({ a: [ok()], b: [{ status: 500 }] })
    const cache = new CapabilityCache({ fetch, clock: fakeClock() })
    expect((await cache.get('a')).capabilities).toEqual(ALL_ON)
    expect(await cache.get('b')).toEqual({
      kind: 'ok',
      capabilities: NEVER_READ_CAPABILITIES,
      source: 'default',
    })
    expect(fetch.mock.calls.map(([org]) => org)).toEqual(['a', 'b'])
  })

  it('401 -> session_expired', async () => {
    const cache = new CapabilityCache({
      fetch: fakeFetch({ o1: [{ status: 401 }] }),
      clock: fakeClock(),
    })
    expect(await cache.get('o1')).toEqual({
      kind: 'session_expired',
      capabilities: NEVER_READ_CAPABILITIES,
      source: 'default',
    })
  })

  it('concurrent reads share one request; clear() drops a read already in flight', async () => {
    let release!: () => void
    const fetch = vi.fn<CapabilityFetch>(async () => {
      await new Promise<void>((resolve) => (release = resolve))
      return ok()
    })
    const cache = new CapabilityCache({ fetch, clock: fakeClock() })
    const first = cache.get('o1')
    const second = cache.get('o1')
    cache.clear()
    release()
    await Promise.all([first, second])
    expect(fetch).toHaveBeenCalledTimes(1)
    const next = cache.get('o1')
    release()
    expect((await next).source).toBe('fresh')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('drive_connector is optional in parseCapabilities: missing or non-boolean -> false, body stays valid', () => {
    const withoutDrive = parseCapabilities({
      sync_feed: true,
      sync_write: true,
      offline_library: false,
      ai_uniwork: true,
      ai_uniwork_formats: ['docx'],
      ttl_seconds: 120,
    })
    expect(withoutDrive).toEqual({
      capabilities: {
        sync_feed: true,
        sync_write: true,
        offline_library: false,
        ai_uniwork: true,
        ai_uniwork_formats: ['docx'],
        drive_connector: false,
      },
      ttlSeconds: 120,
    })

    for (const nonBool of [null, 'true', 1, {}, []]) {
      const parsed = parseCapabilities({
        sync_feed: true,
        sync_write: false,
        offline_library: true,
        ai_uniwork: false,
        drive_connector: nonBool,
      })
      expect(parsed?.capabilities.drive_connector).toBe(false)
    }

    const withDriveTrue = parseCapabilities({
      sync_feed: false,
      sync_write: true,
      offline_library: false,
      ai_uniwork: false,
      drive_connector: true,
    })
    expect(withDriveTrue?.capabilities.drive_connector).toBe(true)
  })

  it('401 after TTL degrades drive_connector to false along with ai_uniwork', async () => {
    const clock = fakeClock()
    const fetch = fakeFetch({ o1: [ok({ drive_connector: true }), { status: 401 }] })
    const cache = new CapabilityCache({ fetch, clock })
    expect((await cache.get('o1')).capabilities.drive_connector).toBe(true)
    clock.advance(300_000)
    const expired = await cache.get('o1')
    expect(expired).toEqual({
      kind: 'session_expired',
      capabilities: {
        sync_feed: true,
        sync_write: true,
        offline_library: true,
        ai_uniwork: false,
        ai_uniwork_formats: [],
        drive_connector: false,
      },
      source: 'stale',
    })
  })
})

describe('capability fetch', () => {
  it('reads the org route and maps the final 401 to status 401', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response('', { status: 401 }))
    const read = createCapabilityFetch({
      apiOrigin: 'https://uniwork.example',
      authorized: (call) => call('tok'),
      isSignedIn: () => true,
      fetch,
    })
    expect(await read('org_1')).toEqual({ status: 401, body: undefined })
    expect(new URL(fetch.mock.calls[0]![0]).pathname).toBe('/api/v1/orgs/org_1/office/capabilities')
  })

  it('a network failure rejects (offline)', async () => {
    const read = createCapabilityFetch({
      apiOrigin: 'https://uniwork.example',
      authorized: (call) => call('tok'),
      isSignedIn: () => true,
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    })
    await expect(read('org_1')).rejects.toMatchObject({ code: 'network' })
  })
})
