import { describe, expect, it, vi } from 'vitest'
import {
  UniworkCloudError,
  type UniworkCloudErrorCode,
  type UniworkCloudStatus,
} from '@genoffice/ai-provider'
import {
  UniworkCloudController,
  createUniworkCloudClient,
  parseCloudStatus,
  statusFromServer,
  type CloudAccountView,
  type UniworkCloudClient,
} from '../src/main/uniwork-auth/cloud'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { TransportError, type FetchLike } from '../src/main/uniwork-auth/transport'

const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  channel: 'stable',
}

const TOKEN_1 = 'at_secret_one'
const TOKEN_2 = 'at_secret_two'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const STATUS_BODY = {
  enabled: true,
  tools: {
    web_search: true,
    image_search: true,
    image_generate: true,
    media_analyze: true,
    transcribe: false,
  },
  credits: {
    unit: 'ai.tokens',
    used: 1200,
    limit: 50000,
    remaining: 48800,
    period_end: '2026-11-01T00:00:00Z',
  },
}

/**
 * Mimics SessionCore.withAccessToken: token 1 first; after a TransportError
 * `unauthorized` one refresh (token 2) and one retry.
 */
function fakeAccount() {
  let token = TOKEN_1
  const refresh = vi.fn(async () => {
    token = TOKEN_2
  })
  const withAccessToken = async <T>(call: (t: string) => Promise<T>): Promise<T> => {
    try {
      return await call(token)
    } catch (error) {
      if (!(error instanceof TransportError) || error.code !== 'unauthorized') throw error
    }
    await refresh()
    return call(token)
  }
  return { withAccessToken, refresh }
}

function client(fetchImpl: FetchLike, account = fakeAccount(), orgId: string | null = 'org_1') {
  return {
    account,
    client: createUniworkCloudClient({
      profile: () => profile,
      orgId: () => orgId,
      withAccessToken: account.withAccessToken,
      fetch: fetchImpl,
    }),
  }
}

async function codeOf(promise: Promise<unknown>): Promise<UniworkCloudErrorCode> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(UniworkCloudError)
    return (error as UniworkCloudError).code
  }
  throw new Error('expected a rejection')
}

describe('UniWork cloud client', () => {
  it('sends the bearer token to the org cloud route of the profile origin', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(200, STATUS_BODY))
    const { client: c } = client(fetchImpl)
    const status = await c.status()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://uniwork.example/api/v1/orgs/org_1/ai/cloud')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN_1}`)
    expect(init.redirect).toBe('error')
    expect(status.tools.transcribe).toBe(false)
    expect(status.credits).toEqual({
      unit: 'ai.tokens',
      used: 1200,
      limit: 50000,
      remaining: 48800,
      periodEnd: '2026-11-01T00:00:00Z',
    })
  })

  it('posts the contract wire format for every tool', async () => {
    const bodies: Record<string, unknown> = {}
    const fetchImpl: FetchLike = async (url, init) => {
      const route = String(url).replace('https://uniwork.example/api/v1/orgs/org_1/ai/cloud', '')
      bodies[route] = JSON.parse(String(init.body))
      if (route === '/search')
        return json(200, {
          results: [
            {
              title: 'T',
              url: 'https://a.example/',
              snippet: 'S',
              image_url: 'https://a.example/i.png',
            },
          ],
          answer: 'A',
        })
      if (route === '/images')
        return json(200, { images: [{ mime: 'image/png', data_base64: 'iVBO' }], model: 'm1' })
      return json(200, { text: 'done' })
    }
    const { client: c } = client(fetchImpl)
    const search = await c.search({ query: 'q', kind: 'image', maxResults: 4 })
    expect(search).toEqual({
      results: [
        {
          title: 'T',
          url: 'https://a.example/',
          snippet: 'S',
          imageUrl: 'https://a.example/i.png',
        },
      ],
      answer: 'A',
    })
    const images = await c.generateImage({
      prompt: 'p',
      aspectRatio: '16:9',
      referenceImages: [{ mime: 'image/png', dataBase64: 'AAAA' }],
    })
    expect(images).toEqual({ images: [{ mime: 'image/png', dataBase64: 'iVBO' }], model: 'm1' })
    await c.analyzeMedia({ requirements: 'r', media: [{ mime: 'image/jpeg', dataBase64: 'BBBB' }] })
    await c.transcribe({ prompt: 'names', audio: { mime: 'audio/mpeg', dataBase64: 'CCCC' } })
    expect(bodies).toEqual({
      '/search': { query: 'q', kind: 'image', max_results: 4 },
      '/images': {
        prompt: 'p',
        aspect_ratio: '16:9',
        reference_images: [{ mime: 'image/png', data_base64: 'AAAA' }],
      },
      '/media/analyze': { requirements: 'r', media: [{ mime: 'image/jpeg', data_base64: 'BBBB' }] },
      '/transcribe': { prompt: 'names', audio: { mime: 'audio/mpeg', data_base64: 'CCCC' } },
    })
  })

  it('refreshes once after a 401 and retries with the new token', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = async (_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization!
      seen.push(auth)
      return auth === `Bearer ${TOKEN_1}`
        ? json(401, { error: { code: 'unauthorized' } })
        : json(200, STATUS_BODY)
    }
    const { client: c, account } = client(fetchImpl)
    await c.status()
    expect(account.refresh).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([`Bearer ${TOKEN_1}`, `Bearer ${TOKEN_2}`])
  })

  it('a second 401 after the refresh reads as signed out (no loop)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(401, {}))
    const { client: c, account } = client(fetchImpl)
    expect(await codeOf(c.search({ query: 'q', kind: 'web', maxResults: 3 }))).toBe('signed_out')
    expect(account.refresh).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([
    [402, {}, 'credits_exhausted'],
    [402, { error: { code: 'credits_exhausted' } }, 'credits_exhausted'],
    [403, { error: { code: 'entitlement_required' } }, 'entitlement_required'],
    [403, {}, 'entitlement_required'],
    [503, { error: { code: 'cloud_unavailable' } }, 'cloud_unavailable'],
    [503, {}, 'cloud_unavailable'],
    [429, {}, 'rate_limited'],
    [400, { code: 'invalid_request' }, 'invalid_request'],
    [413, {}, 'invalid_request'],
    [500, {}, 'server_error'],
  ] as const)('maps HTTP %i %j to %s', async (status, body, code) => {
    const { client: c, account } = client(async () => json(status, body))
    expect(await codeOf(c.generateImage({ prompt: 'p' }))).toBe(code)
    expect(account.refresh).not.toHaveBeenCalled()
  })

  it('maps a network failure and a malformed body, never echoing the token', async () => {
    const down = client(async () => {
      throw new TypeError(`fetch failed for ${TOKEN_1}`)
    })
    const error = await down.client.analyzeMedia({ requirements: 'r', media: [] }).catch((e) => e)
    expect(error).toBeInstanceOf(UniworkCloudError)
    expect(error.code).toBe('network')
    expect(String(error.message)).not.toContain(TOKEN_1)
    const bad = client(async () => json(200, { results: 'nope' }))
    expect(await codeOf(bad.client.search({ query: 'q', kind: 'web', maxResults: 1 }))).toBe(
      'malformed_response',
    )
  })

  it('refuses without a profile or an organization, before any request', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(200, STATUS_BODY))
    const noOrg = client(fetchImpl, fakeAccount(), null)
    expect(await codeOf(noOrg.client.status())).toBe('signed_out')
    const badOrg = client(fetchImpl, fakeAccount(), '../billing')
    expect(await codeOf(badOrg.client.status())).toBe('invalid_request')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('an aborted call stops and reports aborted', async () => {
    const controller = new AbortController()
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const { client: c } = client(fetchImpl)
    const pending = c.transcribe(
      { audio: { mime: 'audio/wav', dataBase64: 'AA' } },
      controller.signal,
    )
    controller.abort()
    expect(await codeOf(pending)).toBe('aborted')
  })
})

describe('cloud status mapping', () => {
  const account: CloudAccountView = {
    signedIn: true,
    orgId: 'org_1',
    email: 'a@x.example',
    planName: 'Pro',
  }

  it('parses defaults leniently and rejects a missing enabled flag', () => {
    expect(parseCloudStatus({ enabled: false }).tools.web_search).toBe(false)
    expect(() => parseCloudStatus({ tools: {} })).toThrow(UniworkCloudError)
  })

  it('ready / credits-exhausted / unavailable / not-entitled', () => {
    const ready = statusFromServer(parseCloudStatus(STATUS_BODY), account)
    expect(ready).toMatchObject({
      state: 'ready',
      enabled: true,
      email: 'a@x.example',
      planName: 'Pro',
    })
    const exhausted = statusFromServer(
      parseCloudStatus({ ...STATUS_BODY, credits: { ...STATUS_BODY.credits, remaining: 0 } }),
      account,
    )
    expect(exhausted.state).toBe('credits-exhausted')
    expect(exhausted.enabled).toBe(true)
    const noTools = statusFromServer(parseCloudStatus({ enabled: true, tools: {} }), account)
    expect(noTools.state).toBe('unavailable')
    const notEntitled = statusFromServer(
      parseCloudStatus({ enabled: false, reason: 'entitlement_required' }),
      account,
    )
    expect(notEntitled).toMatchObject({ state: 'not-entitled', enabled: false })
  })
})

describe('UniworkCloudController', () => {
  function setup(account: CloudAccountView, status: UniworkCloudClient['status']) {
    const published: UniworkCloudStatus[] = []
    const fake: UniworkCloudClient = {
      status,
      search: vi.fn(async () => ({ results: [] })),
      generateImage: vi.fn(async () => {
        throw new UniworkCloudError('credits_exhausted', 402)
      }),
      analyzeMedia: vi.fn(async () => ({ text: 't' })),
      transcribe: vi.fn(async () => ({ text: 't' })),
    }
    let view = account
    const controller = new UniworkCloudController({
      client: fake,
      account: () => view,
      publish: (s) => published.push(s),
    })
    return { controller, published, setView: (v: CloudAccountView) => (view = v) }
  }
  const signedIn: CloudAccountView = { signedIn: true, orgId: 'org_1' }

  it('publishes signed-out at once without a session (no request)', async () => {
    const status = vi.fn(async () => parseCloudStatus(STATUS_BODY))
    const { controller } = setup({ signedIn: false, orgId: null }, status)
    expect((await controller.refresh()).state).toBe('signed-out')
    expect(status).not.toHaveBeenCalled()
  })

  it('reads the status, then drops to signed-out on sign-out', async () => {
    const { controller, published, setView } = setup(signedIn, async () =>
      parseCloudStatus(STATUS_BODY),
    )
    expect((await controller.refresh()).state).toBe('ready')
    setView({ signedIn: false, orgId: null })
    await controller.refresh()
    expect(published.map((s) => s.state)).toEqual(['ready', 'signed-out'])
  })

  it('keeps the last answer for the same org through an outage', async () => {
    let fail = false
    const { controller } = setup(signedIn, async () => {
      if (fail) throw new UniworkCloudError('network')
      return parseCloudStatus(STATUS_BODY)
    })
    await controller.refresh()
    fail = true
    expect((await controller.refresh()).state).toBe('ready')
  })

  it('a 402 from a tool call shows out of credits and re-reads the status', async () => {
    const status = vi.fn(async () => parseCloudStatus(STATUS_BODY))
    const { controller, published } = setup(signedIn, status)
    await controller.refresh()
    const error = await controller
      .transport()
      .generateImage({ prompt: 'p' })
      .catch((e) => e)
    expect(error.code).toBe('credits_exhausted')
    const exhausted = published.find((s) => s.state === 'credits-exhausted')
    expect(exhausted?.credits?.remaining).toBe(0)
    // the re-read is the server's verdict (this fake still reports credits left)
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2))
  })

  it('published statuses never carry a token', async () => {
    const { controller, published } = setup(
      { signedIn: true, orgId: 'org_1', email: 'a@x.example' },
      async () => parseCloudStatus(STATUS_BODY),
    )
    await controller.refresh()
    const payload = JSON.stringify(published)
    expect(payload).not.toMatch(/at_secret|Bearer|access_?token/i)
  })
})
