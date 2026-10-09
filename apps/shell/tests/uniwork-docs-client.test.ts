import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { AccountManager } from '../src/main/uniwork-auth/manager'
import type { DesktopSession, UniworkTransport } from '../src/main/uniwork-auth/transport'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { createMemoryCredentialStore } from './uniwork-auth-fakes'

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string) => json(status, { error: { code, message: 'x' } })

function client(
  fetch: FetchLike,
  authorized = <T>(call: (t: string) => Promise<T>) => call('tok'),
) {
  return createUniworkDocsClient({ apiOrigin: ORIGIN, authorized, isSignedIn: () => true, fetch })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof UniworkDocError ? error.code : `other:${String(error)}`
  }
  return 'resolved'
}

describe('egress', () => {
  it('builds only apiOrigin/api/v1 URLs, never follows redirects, never caches', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, { workspaces: [{ id: 'ws_1', name: 'Team', organization_id: 'org_a' }] }),
    )
    const api = client(fetch)
    expect(await api.listWorkspaces('org_a')).toEqual([
      { id: 'ws_1', name: 'Team', orgId: 'org_a' },
    ])
    await api.listDocuments({ workspaceId: 'ws_1' }).catch(() => undefined)
    await api
      .listDocuments({ workspaceId: 'ws_1', query: 'plan', cursor: 'c1' })
      .catch(() => undefined)
    await api.getDocument(DOC).catch(() => undefined)
    await api.download(DOC, 2).catch(() => undefined)
    const urls = fetch.mock.calls.map(([url]) => url)
    expect(urls).toEqual([
      `${ORIGIN}/api/v1/orgs/org_a/workspaces`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents/recent?limit=50&kind=file`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents?q=plan&cursor=c1&limit=50&kind=file`,
      `${ORIGIN}/api/v1/documents/${DOC}`,
      `${ORIGIN}/api/v1/documents/${DOC}/download?version=2`,
    ])
    for (const [, init] of fetch.mock.calls) {
      expect(init.redirect).toBe('error')
      expect(init.cache).toBe('no-store')
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('refuses ids that would leave the route', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, {}))
    const api = client(fetch)
    expect(await codeOf(api.getDocument('../../evil'))).toBe('not_found')
    expect(await codeOf(api.getDocument('a/b'))).toBe('not_found')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a redirect is an error, never followed', async () => {
    const refused = client(async () => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') })
    })
    expect(await codeOf(refused.getDocument(DOC))).toBe('server_error')
    const redirected = client(async () => {
      const response = json(200, {})
      Object.defineProperty(response, 'redirected', { value: true })
      return response
    })
    expect(await codeOf(redirected.getDocument(DOC))).toBe('server_error')
    const otherHost = client(async () => {
      const response = json(200, {})
      Object.defineProperty(response, 'url', { value: 'https://storage.example/x' })
      return response
    })
    expect(await codeOf(otherHost.getDocument(DOC))).toBe('server_error')
  })

  it('times out a stalled request', async () => {
    const api = createUniworkDocsClient({
      apiOrigin: ORIGIN,
      authorized: (call) => call('tok'),
      isSignedIn: () => true,
      metadataTimeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })
    expect(await codeOf(api.getDocument(DOC))).toBe('timeout')
  })

  it('not signed in never reaches the network', async () => {
    const fetch = vi.fn<FetchLike>()
    const api = createUniworkDocsClient({
      apiOrigin: ORIGIN,
      authorized: (call) => call('tok'),
      isSignedIn: () => false,
      fetch,
    })
    expect(await codeOf(api.listWorkspaces('org_a'))).toBe('not_signed_in')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('error envelope mapping', () => {
  const cases: Array<[Response, string]> = [
    [envelope(403, 'forbidden'), 'forbidden'],
    [envelope(403, 'quota_exceeded'), 'quota_exceeded'],
    [new Response('denied', { status: 403 }), 'server_error'],
    [envelope(404, 'not_found'), 'not_found'],
    [new Response('', { status: 404 }), 'server_error'],
    [envelope(410, 'document_deleted'), 'deleted'],
    [envelope(413, 'file_too_large'), 'too_large'],
    [envelope(409, 'idempotency_payload_mismatch'), 'idempotency_mismatch'],
    [envelope(409, 'idempotency_key_reuse'), 'idempotency_mismatch'],
    [envelope(409, 'engine_incompatible'), 'engine_incompatible'],
    [envelope(502, 'bad_gateway'), 'server_error'],
  ]
  it.each(cases.map(([response, code], i) => [i, response, code] as const))(
    'case %i -> %s',
    async (_i, response, code) => {
      expect(await codeOf(client(async () => response.clone()).getDocument(DOC))).toBe(code)
    },
  )

  it('409 document_version_conflict keeps fields.current_revision as a string', async () => {
    const api = client(async () =>
      json(409, {
        error: {
          code: 'document_version_conflict',
          message: 'x',
          fields: { current_revision: '90071992547409931' },
        },
      }),
    )
    try {
      await api.commit({ documentId: DOC, uploadId: 'u', baseRevision: '41', idempotencyKey: 'k' })
      throw new Error('expected a conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(UniworkDocError)
      expect((error as UniworkDocError).code).toBe('conflict')
      expect((error as UniworkDocError).currentRevision).toBe('90071992547409931')
    }
  })

  it('strict parsing: a revision as a number is malformed', async () => {
    const api = client(async () =>
      json(200, {
        document: {
          id: DOC,
          organization_id: 'o',
          workspace_id: 'w',
          title: 't.docx',
          kind: 'file',
          revision: 41,
          current_version: 1,
          file: {
            filename: 't.docx',
            mime_type: '',
            version: 1,
            checksum_sha256: 'a'.repeat(64),
            size_bytes: 1,
          },
        },
      }),
    )
    expect(await codeOf(api.getDocument(DOC))).toBe('malformed_response')
  })

  it('sends the commit body in snake_case with the revision as a decimal string', async () => {
    const fetch = vi.fn<FetchLike>(async () => envelope(500, 'internal'))
    await client(fetch)
      .commit({
        documentId: DOC,
        uploadId: 'up_1',
        baseRevision: '41',
        idempotencyKey: 'office-key-1',
      })
      .catch(() => undefined)
    const [, init] = fetch.mock.calls[0]!
    expect(JSON.parse(String(init.body))).toEqual({ upload_id: 'up_1', base_revision: '41' })
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('office-key-1')
  })
})

describe('401: one shared refresh, one retry (real account session)', () => {
  const profile: DeploymentProfile = {
    deploymentId: 'default',
    apiOrigin: ORIGIN,
    clientId: 'uniwork-office',
    channel: 'stable',
  }
  let seq = 0
  const session = (): DesktopSession => {
    seq += 1
    return {
      accountId: 'acc_1',
      deviceSessionId: 'dev_1',
      sessionId: 's',
      deploymentId: 'default',
      accessToken: `at_${seq}`,
      refreshToken: `rt_${seq}`,
      expiresIn: 900,
      refreshExpiresIn: 86400,
    }
  }
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z'), toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  async function signedIn() {
    const transport = {
      start: vi.fn(async () => ({ authorizationUrl: `${ORIGIN}/auth/desktop/authorize?a=1` })),
      exchange: vi.fn(async () => session()),
      refresh: vi.fn(async () => session()),
      logout: vi.fn(async () => undefined),
      me: vi.fn(async () => ({ id: 'acc_1', email: 'mai@example.com', displayName: 'Mai' })),
      orgs: vi.fn(async () => [
        { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', status: 'active' },
      ]),
      billing: vi.fn(async () => ({
        planCode: 'p',
        planName: 'P',
        status: 'active',
        features: [],
      })),
    } satisfies UniworkTransport
    const manager = new AccountManager({
      resolveProfile: () => profile,
      createTransport: () => transport,
      credentials: createMemoryCredentialStore(),
      openBrowser: async () => undefined,
      readSelectedOrgId: () => 'org_a',
      persistSelectedOrgId: () => undefined,
    })
    await manager.login()
    const state = (transport.start.mock.calls.at(-1)?.[0] as { state: string }).state
    await manager.completeCallback(
      `uniwork-office://auth/callback?code=c&state=${encodeURIComponent(state)}`,
    )
    expect(manager.status().state).toBe('signed-in')
    return { manager, transport }
  }

  it('refreshes once and retries with the new token', async () => {
    const { manager, transport } = await signedIn()
    const seen: string[] = []
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization
      seen.push(auth)
      return seen.length === 1 ? envelope(401, 'unauthorized') : json(200, { workspaces: [] })
    })
    const api = client(fetch, (call) => manager.authorizedRequest(call))
    expect(await api.listWorkspaces('org_a')).toEqual([])
    expect(transport.refresh).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
  })

  it('a second 401 is session_expired; concurrent 401s share one refresh', async () => {
    const { manager, transport } = await signedIn()
    const api = client(
      async () => envelope(401, 'unauthorized'),
      (call) => manager.authorizedRequest(call),
    )
    const [a, b] = await Promise.all([
      codeOf(api.listWorkspaces('org_a')),
      codeOf(api.listWorkspaces('org_a')),
    ])
    expect([a, b]).toEqual(['session_expired', 'session_expired'])
    expect(transport.refresh).toHaveBeenCalledTimes(1)
  })

  const exchangeInput = {
    launchTicket: 't',
    deploymentId: 'default',
    clientId: 'uniwork-office',
    deviceSessionId: 'dev_1',
  }
  const exchanged = {
    receipt_id: 'r1',
    redeemed_at: '2026-10-01T00:00:00Z',
    document: {
      id: DOC,
      organization_id: 'org_a',
      workspace_id: 'ws_1',
      title: 'Plan.docx',
      kind: 'file',
      operation: 'edit',
      version: 0,
      revision: '4',
      download_path: `/api/v1/documents/${DOC}/download`,
    },
  }

  it('the launch exchange refreshes once on a 401 (an idle-expired token) and redeems', async () => {
    const { manager, transport } = await signedIn()
    const seen: string[] = []
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      seen.push((init.headers as Record<string, string>).Authorization)
      return seen.length === 1 ? envelope(401, 'unauthorized') : json(200, exchanged)
    })
    const api = client(fetch, (call) => manager.authorizedRequest(call))
    expect((await api.exchange(exchangeInput)).id).toBe(DOC)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(transport.refresh).toHaveBeenCalledTimes(1)
    expect(seen[0]).not.toBe(seen[1])
  })

  it('a second 401 on the launch exchange is session_expired', async () => {
    const { manager, transport } = await signedIn()
    const fetch = vi.fn<FetchLike>(async () => envelope(401, 'unauthorized'))
    const api = client(fetch, (call) => manager.authorizedRequest(call))
    expect(await codeOf(api.exchange(exchangeInput))).toBe('session_expired')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(transport.refresh).toHaveBeenCalledTimes(1)
  })
})
