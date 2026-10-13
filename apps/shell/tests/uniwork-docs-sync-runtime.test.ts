import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStatus } from '../src/shared/home-api'
import type { UniworkDocsService } from '../src/main/uniwork-docs/service'

/**
 * R1-be-8: the capability cache is per-account state. The wiring used to
 * rebuild it only when the deployment origin changed, so after a same-origin
 * account switch account A's per-org flags answered for B until the TTL ran
 * out. The runtime here is the production `createSyncRuntime`, driven through
 * its tick with a fake clock and a fake HTTP round trip.
 */

let dir: string
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null
/** the account status the runtime's targets read (a two-org picker by default) */
let accountStatus: AccountStatus = {
  loggedIn: true,
  state: 'signed-in',
  needsOrgChoice: true,
  orgs: [
    { id: 'org_a', name: 'Org A', slug: 'org-a', role: 'owner', membership: 'active' },
    { id: 'org_b', name: 'Org B', slug: 'org-b', role: 'member', membership: 'active' },
  ],
}
/** what the fake server answers for `org_a`'s capability route */
let capabilityAnswer: Record<string, unknown> = {}
const fetched: string[] = []

vi.mock('electron', () => ({
  app: { getPath: () => dir },
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
  onUniworkAccountStatus: () => () => undefined,
  uniworkAccount: () => ({
    status: (): AccountStatus =>
      identity ? accountStatus : { loggedIn: false, state: 'signed-out' },
  }),
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

/** the deployment's HTTP surface the runtime touches: capabilities + workspaces */
function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const path = new URL(String(input)).pathname
  fetched.push(path)
  if (path.endsWith('/office/capabilities')) return Promise.resolve(json(200, capabilityAnswer))
  if (path.endsWith('/workspaces')) return Promise.resolve(json(200, { workspaces: [] }))
  return Promise.resolve(json(200, {}))
}

const capabilityFetches = () => fetched.filter((path) => path.endsWith('/office/capabilities'))
const workspaceFetches = () => fetched.filter((path) => path.endsWith('/workspaces'))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-sync-runtime-'))
  identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
  fetched.length = 0
  accountStatus = {
    loggedIn: true,
    state: 'signed-in',
    needsOrgChoice: true,
    orgs: [
      { id: 'org_a', name: 'Org A', slug: 'org-a', role: 'owner', membership: 'active' },
      { id: 'org_b', name: 'Org B', slug: 'org-b', role: 'member', membership: 'active' },
    ],
  }
  capabilityAnswer = {
    sync_feed: true,
    sync_write: true,
    offline_library: false,
    ai_uniwork: false,
    ai_uniwork_formats: [],
    ttl_seconds: 300,
  }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function runtimeWith() {
  const { createSyncRuntime } = await import('../src/main/uniwork-docs/wiring')
  // only hasLocalDraft is read from the service by the runtime
  const service = { hasLocalDraft: async () => false } as unknown as UniworkDocsService
  return createSyncRuntime(service, { fetch: fakeFetch, now: () => 1_000_000 })
}

describe('the feed runtime capability cache across an account boundary (R1-be-8)', () => {
  it('clears on a same-origin account switch instead of serving the old account’s flags', async () => {
    chosen('org_a')
    const runtime = await runtimeWith()

    // account A: org_a says the feed is on, the pass lists its workspaces
    await runtime.tick()
    expect(capabilityFetches()).toHaveLength(1)
    expect(workspaceFetches()).toHaveLength(1)

    // a second pass lists the workspaces again but reads the cached capability
    await runtime.tick()
    expect(capabilityFetches()).toHaveLength(1)
    expect(workspaceFetches()).toHaveLength(2)

    // account B signs in on the same origin; B's answer says the feed is off
    capabilityAnswer = { ...capabilityAnswer, sync_feed: false }
    identity = { accountId: 'acc_2', deviceSessionId: 'dev_2', deploymentId: 'default' }
    await runtime.tick()

    // a fresh read under B (never A's cached value), and no workspace listing:
    // had A's `sync_feed: true` leaked, this pass would list them again
    expect(capabilityFetches()).toHaveLength(2)
    expect(workspaceFetches()).toHaveLength(2)

    // and the new account's value is cached in turn
    await runtime.tick()
    expect(capabilityFetches()).toHaveLength(2)
    expect(workspaceFetches()).toHaveLength(2)
  })

  it('keeps serving the cache inside the TTL for one account', async () => {
    chosen('org_a')
    const runtime = await runtimeWith()
    await runtime.tick()
    await runtime.tick()
    await runtime.tick()
    expect(capabilityFetches()).toHaveLength(1)
  })
})

/** the signed-in status of an account that picked `orgId` (the picker is done) */
function chosen(orgId: string): void {
  const org = accountStatus.orgs?.find((o) => o.id === orgId)
  accountStatus = {
    loggedIn: true,
    state: 'signed-in',
    needsOrgChoice: false,
    org,
    orgs: accountStatus.orgs,
  }
}

describe('G8-16 S16: the feed makes no org-scoped call before the choice (F-1)', () => {
  it('a two-org picker fetches nothing until the org is chosen', async () => {
    const runtime = await runtimeWith()

    // signed in with two usable orgs and nothing chosen: the picker is up, so
    // no capability, workspace or feed request may run for any org
    await runtime.tick()
    expect(capabilityFetches()).toEqual([])
    expect(workspaceFetches()).toEqual([])
    expect(fetched).toEqual([])

    // the choice's status push is what lets the feed run, and only for it
    chosen('org_a')
    await runtime.tick()
    expect(capabilityFetches()).toEqual(['/api/v1/orgs/org_a/office/capabilities'])
    expect(workspaceFetches()).toEqual(['/api/v1/orgs/org_a/workspaces'])
    expect(fetched.some((path) => path.includes('org_b'))).toBe(false)
  })

  it('a chosen org is the only one ever touched', async () => {
    chosen('org_b')
    const runtime = await runtimeWith()
    await runtime.tick()
    expect(capabilityFetches()).toEqual(['/api/v1/orgs/org_b/office/capabilities'])
    expect(fetched.some((path) => path.includes('org_a'))).toBe(false)
  })

  it('no org chosen (every org blocked) still fetches nothing', async () => {
    accountStatus = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      orgs: [{ id: 'org_a', name: 'Org A', slug: 'org-a', role: 'owner', membership: 'active' }],
    }
    const runtime = await runtimeWith()
    await runtime.tick()
    expect(fetched).toEqual([])
  })
})
