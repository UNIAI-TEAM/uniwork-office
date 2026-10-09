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
import type { FetchLike } from '../src/main/uniwork-auth/transport'

/** fork review fixes (F3): status reasons, error codes, locale, retries, fresh reads, membership */

const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  channel: 'stable',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const STATUS_BODY = {
  enabled: true,
  tools: {
    web_search: true,
    image_search: true,
    image_generate: true,
    media_analyze: true,
    transcribe: true,
  },
  credits: { unit: 'ai.tokens', used: 1200, limit: 50000, remaining: 48800, period_end: null },
}

const account: CloudAccountView = { signedIn: true, orgId: 'org_1' }

function clientWith(fetchImpl: FetchLike, locale?: () => string | null) {
  return createUniworkCloudClient({
    profile: () => profile,
    orgId: () => 'org_1',
    withAccessToken: (call) => call('tok'),
    ...(locale ? { locale } : {}),
    fetch: fetchImpl,
  })
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

describe('status: why the server says the cloud is off (M2, m5)', () => {
  const off = (reason?: string) =>
    statusFromServer(parseCloudStatus({ enabled: false, ...(reason ? { reason } : {}) }), account)

  it.each([
    ['entitlement_required', 'not-entitled'],
    [undefined, 'not-entitled'],
    ['subscription_inactive', 'subscription-inactive'],
    ['cloud_unavailable', 'unavailable'],
    ['something_new', 'unavailable'],
  ] as const)('reason %s reads as %s', (reason, state) => {
    const status = off(reason)
    expect(status.state).toBe(state)
    expect(status.enabled).toBe(false)
  })

  it('a zero credit cap is not "out of credits": the plan has no AI credits', () => {
    const status = statusFromServer(
      parseCloudStatus({
        ...STATUS_BODY,
        credits: { unit: 'ai.tokens', used: 0, limit: 0, remaining: 0 },
      }),
      account,
    )
    expect(status).toMatchObject({ state: 'not-entitled', enabled: false, credits: null })
  })
})

describe('client: error codes and the analysis language (m3, m6)', () => {
  const codeFor = (status: number, body: unknown) =>
    codeOf(
      clientWith(async () => json(status, body)).search({ query: 'q', kind: 'web', maxResults: 3 }),
    )

  it('maps the billing and membership answers', async () => {
    expect(await codeFor(403, { error: { code: 'subscription_inactive' } })).toBe(
      'subscription_inactive',
    )
    expect(await codeFor(403, { error: { code: 'forbidden' } })).toBe('no_access')
    expect(await codeFor(404, { error: { code: 'not_found' } })).toBe('no_access')
    expect(await codeFor(404, {})).toBe('no_access')
    // a plan refusal keeps its meaning
    expect(await codeFor(403, { error: { code: 'entitlement_required' } })).toBe(
      'entitlement_required',
    )
    expect(await codeFor(403, {})).toBe('entitlement_required')
  })

  it('sends the UI language to media analysis, and omits it when unknown', async () => {
    const bodies: unknown[] = []
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)))
      return json(200, { text: 'x' })
    }
    const media = [{ mime: 'image/png', dataBase64: 'AAAA' }]
    for (const locale of ['vi', 'en', null] as const) {
      await clientWith(fetchImpl, () => locale).analyzeMedia({ requirements: 'r', media })
    }
    const wire = [{ mime: 'image/png', data_base64: 'AAAA' }]
    expect(bodies).toEqual([
      { requirements: 'r', media: wire, locale: 'vi' },
      { requirements: 'r', media: wire, locale: 'en' },
      { requirements: 'r', media: wire },
    ])
  })
})

describe('controller: retries, fresh reads, membership (m1, m2, m6)', () => {
  function make(
    status: UniworkCloudClient['status'],
    extra: Partial<ConstructorParameters<typeof UniworkCloudController>[0]> = {},
  ) {
    const published: UniworkCloudStatus[] = []
    const fake: UniworkCloudClient = {
      status,
      search: vi.fn(async () => ({ results: [] })),
      generateImage: vi.fn(async () => ({ images: [], model: 'm' })),
      analyzeMedia: vi.fn(async () => ({ text: 't' })),
      transcribe: vi.fn(async () => ({ text: 't' })),
    }
    const controller = new UniworkCloudController({
      client: fake,
      account: () => account,
      publish: (s) => published.push(s),
      ...extra,
    })
    return { controller, published, fake }
  }

  it('re-reads on its own after a failed first read, with a growing pause', async () => {
    vi.useFakeTimers()
    try {
      let failures = 2
      const status = vi.fn(async () => {
        if (failures-- > 0) throw new UniworkCloudError('network')
        return parseCloudStatus(STATUS_BODY)
      })
      const { controller, published } = make(status, { retryDelaysMs: [1000, 5000] })
      expect((await controller.refresh()).state).toBe('unavailable')
      expect(status).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(999)
      expect(status).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(status).toHaveBeenCalledTimes(2)
      // the second failure waits the longer pause
      await vi.advanceTimersByTimeAsync(4999)
      expect(status).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(status).toHaveBeenCalledTimes(3)
      expect(published.at(-1)?.state).toBe('ready')
      // answered: no further reads
      await vi.advanceTimersByTimeAsync(60_000)
      expect(status).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry a plan answer, and dispose stops a pending retry', async () => {
    vi.useFakeTimers()
    try {
      const notEntitled = vi.fn(async () => parseCloudStatus({ enabled: false }))
      await make(notEntitled).controller.refresh()
      await vi.advanceTimersByTimeAsync(700_000)
      expect(notEntitled).toHaveBeenCalledTimes(1)

      const down = vi.fn(async () => {
        throw new UniworkCloudError('timeout')
      })
      const b = make(down)
      await b.controller.refresh()
      b.controller.dispose()
      await vi.advanceTimersByTimeAsync(700_000)
      expect(down).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a charge during an in-flight read supersedes it: the stale answer is dropped', async () => {
    let release: () => void = () => undefined
    let calls = 0
    const status = vi.fn(async () => {
      calls++
      if (calls === 1) {
        // started before the call was charged: still reports the old credits
        await new Promise<void>((resolve) => (release = resolve))
        return parseCloudStatus(STATUS_BODY)
      }
      return parseCloudStatus({
        ...STATUS_BODY,
        credits: { ...STATUS_BODY.credits, used: 5200, remaining: 44800 },
      })
    })
    const { controller } = make(status)
    const first = controller.refresh()
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1))
    await controller.transport().search({ query: 'q', kind: 'web', maxResults: 1 })
    await vi.waitFor(() => expect(controller.status().credits?.remaining).toBe(44800))
    release()
    await first
    // the older read finishing late must not roll the credits back
    expect(controller.status().credits?.remaining).toBe(44800)
  })

  it('a 402 flip is not overwritten by a read that started before it', async () => {
    let release: () => void = () => undefined
    let calls = 0
    const status = vi.fn(async () => {
      calls++
      if (calls === 1) return parseCloudStatus(STATUS_BODY)
      if (calls === 2) {
        await new Promise<void>((resolve) => (release = resolve))
        return parseCloudStatus(STATUS_BODY)
      }
      return parseCloudStatus({
        ...STATUS_BODY,
        credits: { ...STATUS_BODY.credits, used: 50000, remaining: 0 },
      })
    })
    const { controller, fake } = make(status)
    vi.mocked(fake.generateImage).mockRejectedValueOnce(
      new UniworkCloudError('credits_exhausted', 402),
    )
    await controller.refresh()
    const stale = controller.refresh({ fresh: true })
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2))
    await controller
      .transport()
      .generateImage({ prompt: 'p' })
      .catch(() => undefined)
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(controller.status().state).toBe('credits-exhausted'))
    release()
    await stale
    expect(controller.status().state).toBe('credits-exhausted')
  })

  it('a 403 forbidden is not a plan problem: the account is re-read, at most once a minute', async () => {
    const refreshAccount = vi.fn(async () => undefined)
    const status = vi.fn(async () => {
      throw new UniworkCloudError('no_access', 403)
    })
    const { controller } = make(status, { refreshAccount })
    expect((await controller.refresh()).state).toBe('unavailable')
    expect(refreshAccount).toHaveBeenCalledTimes(1)
    await controller.refresh()
    expect(refreshAccount).toHaveBeenCalledTimes(1)
  })

  it('a tool call answering subscription_inactive flips the state at once', async () => {
    const { controller, fake, published } = make(async () => parseCloudStatus(STATUS_BODY))
    await controller.refresh()
    vi.mocked(fake.generateImage).mockRejectedValueOnce(
      new UniworkCloudError('subscription_inactive', 403),
    )
    await controller
      .transport()
      .generateImage({ prompt: 'p' })
      .catch(() => undefined)
    // published before the background re-read lands (this fake still answers ready)
    expect(published.map((p) => p.state)).toContain('subscription-inactive')
  })

  it('a tool call answering no_access is never published as not-entitled', async () => {
    const refreshAccount = vi.fn(async () => undefined)
    const { controller, fake, published } = make(async () => parseCloudStatus(STATUS_BODY), {
      refreshAccount,
    })
    await controller.refresh()
    vi.mocked(fake.generateImage).mockRejectedValueOnce(new UniworkCloudError('no_access', 403))
    await controller
      .transport()
      .generateImage({ prompt: 'p' })
      .catch(() => undefined)
    expect(published.map((p) => p.state)).toContain('unavailable')
    expect(published.map((p) => p.state)).not.toContain('not-entitled')
    expect(refreshAccount).toHaveBeenCalledTimes(1)
  })
})
