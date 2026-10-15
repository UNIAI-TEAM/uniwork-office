import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStatus } from '../src/shared/home-api'
import type { UniworkDocsService } from '../src/main/uniwork-docs/service'
import { LeaseManager } from '../src/main/uniwork-sync/lease/manager'

/**
 * W1f (G5-08c): the lease core as the shell builds it. The production
 * `createSyncRuntime` registers the lease store in its layer, builds the lease
 * client from the same authenticated profile the feed uses and renews a due
 * lease on an online poll. The production account boundary locks the leases
 * on sign-out only: an org change (same account, same deployment) does not.
 */

let dir: string
let statusListener: ((status: AccountStatus) => void) | null = null
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null
let statusNow: AccountStatus = { loggedIn: false, state: 'signed-out' }
const requests: Array<{ method: string; path: string; body?: string; auth: string | null }> = []
/** the server clock the fake lease route stamps on its SDO */
let serverNow = Date.parse('2026-10-13T08:00:00Z')
/** how far before the server clock the granted lease was issued (13 h = due) */
let issuedAgoMs = 0

const HOUR = 60 * 60 * 1000
const ORGS = [
  { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' as const },
  { id: 'org_b', name: 'Beta', slug: 'beta', role: 'member', membership: 'active' as const },
]

vi.mock('electron', () => ({
  app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`ENC1${text}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
}))

vi.mock('../src/main/uniwork-auth', () => ({
  authorizedRequest: <T>(call: (token: string) => Promise<T>) => call('fake-token'),
  setUniworkSignOutHooks: vi.fn(),
  onUniworkAccountStatus: (listener: (status: AccountStatus) => void) => {
    statusListener = listener
    return () => undefined
  },
  uniworkAccount: () => ({ status: () => statusNow, retry: async () => undefined }),
  uniworkDeploymentProfile: () => ({
    deploymentId: 'default',
    apiOrigin: 'https://uniwork.example',
    clientId: 'uniwork-office',
    channel: 'stable',
  }),
  uniworkSessionIdentity: () => identity,
}))

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function leaseSdo(documentId: string, renewed: boolean): Record<string, unknown> {
  const issued = serverNow - issuedAgoMs
  return {
    lease: `ofl1.signed-${renewed ? 'renewed' : 'granted'}-${issued}`,
    lease_id: '01J8X4LEASE1P2Q3R4S5T6U7V8',
    document_id: documentId,
    organization_id: 'org_a',
    workspace_id: 'ws_1',
    version_id: 'ver_1',
    version: 1,
    revision: '10',
    level: 'view',
    policy_epoch: 0,
    generation: renewed ? 2 : 1,
    renewed,
    issued_at: new Date(issued).toISOString(),
    expires_at: new Date(issued + 24 * HOUR).toISOString(),
    renew_after: new Date(issued + 12 * HOUR).toISOString(),
    server_time: new Date(serverNow).toISOString(),
  }
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = new URL(String(input)).pathname
  const method = init?.method ?? 'GET'
  const headers = new Headers(init?.headers)
  requests.push({
    method,
    path,
    ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    auth: headers.get('Authorization'),
  })
  if (path.endsWith('/office/capabilities')) {
    return Promise.resolve(
      json(200, {
        sync_feed: true,
        sync_write: false,
        offline_library: true,
        ai_uniwork: false,
        ai_uniwork_formats: [],
        ttl_seconds: 300,
      }),
    )
  }
  if (path.endsWith('/workspaces')) return Promise.resolve(json(200, { workspaces: [] }))
  const lease = /^\/api\/v1\/documents\/([^/]+)\/office\/offline-lease$/.exec(path)
  if (lease) {
    if (method === 'DELETE') return Promise.resolve(json(200, { status: 'ok' }))
    const renewed = typeof init?.body === 'string'
    if (renewed) issuedAgoMs = 0
    return Promise.resolve(json(200, leaseSdo(decodeURIComponent(lease[1] ?? ''), renewed)))
  }
  return Promise.resolve(json(200, {}))
}

const leaseRequests = () => requests.filter((r) => r.path.endsWith('/office/offline-lease'))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-sync-lease-wiring-'))
  statusListener = null
  identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
  statusNow = { loggedIn: true, state: 'signed-in', needsOrgChoice: false, org: ORGS[0], orgs: ORGS }
  requests.length = 0
  serverNow = Date.parse('2026-10-13T08:00:00Z')
  issuedAgoMs = 0
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

async function productionRuntime() {
  const { createSyncRuntime } = await import('../src/main/uniwork-docs/wiring')
  const service = {
    hasLocalDraft: async () => false,
    setQueueOnline: async () => undefined,
    pollSaveQueue: async () => undefined,
  } as unknown as UniworkDocsService
  return createSyncRuntime(service, { fetch: fakeFetch, now: () => serverNow })
}

describe('the production lease wiring (W1f)', () => {
  it('R1BE-2: the production store layer registers offline-leases and a granted lease round-trips', async () => {
    const runtime = await productionRuntime()
    const granted = await runtime.leases.grant('doc_1')
    expect(granted.kind).toBe('renewed')
    const state = await runtime.leases.effectiveState('doc_1')
    expect(state.state).toBe('valid')
    expect(state.record?.lease_id).toBe('01J8X4LEASE1P2Q3R4S5T6U7V8')
    expect(state.level).toBe('view')
  })

  it('R1BE-3: the lease client uses the authenticated feed profile and an online poll renews a due lease once', async () => {
    const runtime = await productionRuntime()
    // the server hands back a lease issued 13 h ago: past renew_after already
    issuedAgoMs = 13 * HOUR
    await runtime.leases.grant('doc_1')
    expect(leaseRequests()).toEqual([
      { method: 'PUT', path: '/api/v1/documents/doc_1/office/offline-lease', auth: 'Bearer fake-token' },
    ])

    await runtime.tick()
    const renewals = leaseRequests().slice(1)
    expect(renewals).toHaveLength(1)
    expect(renewals[0]).toMatchObject({
      method: 'PUT',
      path: '/api/v1/documents/doc_1/office/offline-lease',
      auth: 'Bearer fake-token',
    })
    expect(JSON.parse(renewals[0]?.body ?? '{}')).toEqual({
      lease: `ofl1.signed-granted-${serverNow - 13 * HOUR}`,
    })
    expect((await runtime.leases.effectiveState('doc_1')).record?.generation).toBe(2)
  })
})

describe('the account boundary locks leases on sign-out only (W1f)', () => {
  async function handle() {
    vi.stubGlobal('fetch', fakeFetch)
    const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
    const created = createUniworkDocs({ handle: vi.fn() } as never, {
      shellWindow: () => null,
      shellContents: () => null,
      openPath: () => true,
      refuseLockedPath: () => false,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => dir,
      openPaths: () => [],
      closePath: async () => true,
      confirmClosePath: async () => true,
      closePathNow: () => undefined,
      aiHistoryPaths: () => [],
      forgetAiHistory: () => undefined,
    })
    created.activate(() => undefined)
    return created
  }

  it('R1BE-1: an org change does not lock leases and sends no DELETE', async () => {
    const lockBoundary = vi.spyOn(LeaseManager.prototype, 'lockBoundary')
    const lockAll = vi.spyOn(LeaseManager.prototype, 'lockAll')
    await handle()
    statusListener?.(statusNow)
    await vi.waitFor(() =>
      expect(requests.some((r) => r.path === '/api/v1/orgs/org_a/office/capabilities')).toBe(true),
    )
    statusNow = { ...statusNow, org: ORGS[1] }
    statusListener?.(statusNow)
    await vi.waitFor(() =>
      expect(requests.some((r) => r.path === '/api/v1/orgs/org_b/office/capabilities')).toBe(true),
    )
    expect(lockBoundary).not.toHaveBeenCalled()
    expect(lockAll).not.toHaveBeenCalled()
    expect(requests.filter((r) => r.method === 'DELETE')).toEqual([])
  })

  it('R1BE-1/R1BE-10: sign-out locks the leases at once at the account boundary', async () => {
    const lockBoundary = vi.spyOn(LeaseManager.prototype, 'lockBoundary')
    const created = await handle()
    statusListener?.(statusNow)
    expect(await created.boundary.beforeSignOut()).toBe(true)
    expect(lockBoundary).toHaveBeenCalledWith({ deploymentId: 'default', accountId: 'acc_1' })
    expect(lockBoundary).toHaveReturnedWith('signed_out')
  })
})
