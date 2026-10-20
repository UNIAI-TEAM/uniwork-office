// The loader against the fake test-host avatar route (web/server/fake-avatars.mjs) over real HTTP: the
// contract the UniWork server route has to meet (path shape, Bearer, no cookie, 401 / 404 / type / size).
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAvatarLoader } from './loader'

interface FakeModule {
  handleFakeAvatars(req: unknown, res: unknown, pathname: string): Promise<boolean>
  handleFakeAvatarsControl(req: unknown, res: unknown, pathname: string): Promise<boolean>
}

const DOC = '01HDOC00000000000000000000'
const alice = '01HALICE0000000000000000AA'
const bob = '01HBOB000000000000000000BB'
const path = (user: string) => `/api/v1/office-frame/documents/${DOC}/avatars/${user}`

let server: Server
let origin = ''
let fake: FakeModule
const signal = new AbortController().signal

async function control(body: unknown) {
  await fetch(`${origin}/__fake-avatars/control`, { method: 'POST', body: JSON.stringify(body) })
}

beforeAll(async () => {
  fake = (await import('../../../server/fake-avatars.mjs' as string)) as FakeModule
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    void (async () => {
      if (await fake.handleFakeAvatarsControl(req, res, pathname)) return
      if (await fake.handleFakeAvatars(req, res, pathname)) return
      res.writeHead(404).end()
    })()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

beforeEach(async () => {
  await fetch(`${origin}/__fake-avatars/reset`, { method: 'POST' })
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

function loader() {
  return createAvatarLoader({
    origin,
    getToken: async () => 'tok-1',
    refreshToken: async () => 'tok-2',
  })
}

const log = async () =>
  (await (await fetch(`${origin}/__fake-avatars/log`)).json()) as Array<{
    authorization: string | null
    cookie: string | null
  }>

describe('loader <-> fake avatar route', () => {
  it('a seeded user answers a PNG; the request carries Bearer and no cookie', async () => {
    await control({ users: [alice] })
    expect(await loader().load(path(alice), signal)).toBe('blob:fake')
    expect(await log()).toEqual([
      { method: 'GET', path: path(alice), authorization: 'Bearer tok-1', cookie: null },
    ])
  })

  it('an unseeded user is a 404 -> null, asked once', async () => {
    const l = loader()
    expect(await l.load(path(bob), signal)).toBeNull()
    expect(await l.load(path(bob), signal)).toBeNull()
    expect(await log()).toHaveLength(1)
  })

  it('one 401 is retried with the refreshed token', async () => {
    await control({ users: [alice], unauthorizedOnce: true })
    expect(await loader().load(path(alice), signal)).toBe('blob:fake')
    expect((await log()).map((e) => e.authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2'])
  })

  it('an SVG answer and an oversize body are refused', async () => {
    await control({ users: [alice, bob], wrongType: [alice], oversize: [bob] })
    const l = loader()
    expect(await l.load(path(alice), signal)).toBeNull()
    expect(await l.load(path(bob), signal)).toBeNull()
  })

  it('the route answers HEAD like GET without a body', async () => {
    await control({ users: [alice] })
    const res = await fetch(`${origin}${path(alice)}`, {
      method: 'HEAD',
      headers: { Authorization: 'Bearer t' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
