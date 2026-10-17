import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS, type AccountStatus } from '../src/shared/home-api'
import { TREE_CHANGED_WINDOW_MS } from '../src/main/uniwork-docs/tree-changed'

/**
 * R2-5: the last-owner record follows the session itself. The account status
 * callback that `activate` installs tells the service to note the live
 * identity, so an account that signs in and never touches a UniWork document
 * is still the recorded owner when it signs out.
 */

let dir: string
let statusListener: ((status: AccountStatus) => void) | null = null
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null
/** the status `uniworkAccount().status()` answers (the feed's targets read it) */
let statusNow: AccountStatus = { loggedIn: false, state: 'signed-out' }
/** every `/api/v1/...` path the runtime's HTTP round trip asked for */
let fetched: string[] = []
let fetchedCalls: { url: string; path: string; headers: Record<string, string> }[] = []

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
  onUniworkAccountStatus: (listener: (status: AccountStatus) => void) => {
    statusListener = listener
    return () => undefined
  },
  uniworkAccount: () => ({ status: () => statusNow }),
  uniworkDeploymentProfile: () => ({
    deploymentId: 'default',
    apiOrigin: 'https://uniwork.example',
    clientId: 'uniwork-office',
    channel: 'stable',
  }),
  uniworkSessionIdentity: () => identity,
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-wiring-'))
  statusListener = null
  identity = null
  statusNow = { loggedIn: false, state: 'signed-out' }
  fetched = []
  fetchedCalls = []
  // the runtime's HTTP round trip: record the path, answer a capability that
  // turns the feed off so no workspace or feed read follows
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = new URL(url).pathname
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    fetched.push(path)
    fetchedCalls.push({ url, path, headers })
    return Promise.resolve(
      new Response(
        JSON.stringify({
          sync_feed: false,
          sync_write: false,
          offline_library: false,
          ai_uniwork: false,
          ai_uniwork_formats: [],
          ttl_seconds: 300,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

describe('last owner follows the session identity (R2-5)', () => {
  it('the account status callback records the signed-in account', async () => {
    const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
    const handle = createUniworkDocs({ handle: vi.fn() } as never, {
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
    handle.activate(() => undefined)
    const note = vi.spyOn(handle.service, 'noteSessionIdentity')
    const noteOrg = vi.spyOn(handle.service, 'noteSelectedOrg')
    expect(statusListener).not.toBeNull()
    identity = { accountId: 'acc_9', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusListener?.({ state: 'signed-in' })
    expect(note).toHaveBeenCalledTimes(1)
    // G8-16 S16 / R5-01: a status push also tells the service the selected org
    // (here: none, and without orgsError the absence is a lasting boundary)
    expect(noteOrg).toHaveBeenCalledWith(null, true)
    // a failed /orgs read is transient: the same org-less push forwards
    // orgGone=false so the service keeps the last known org
    statusListener?.({ state: 'signed-in', needsOrgChoice: true, orgsError: 'network' })
    expect(noteOrg).toHaveBeenCalledWith(null, false)
    const doc = {
      deploymentId: 'default',
      userId: 'acc_9',
    } as never
    identity = null
    expect(handle.service.ownsLocally(doc)).toBe(true)
    expect(handle.service.ownsLocally({ deploymentId: 'default', userId: 'acc_1' } as never)).toBe(
      false,
    )
  })
})

describe('the newer-store guard reaches the wiring (G5-04g)', () => {
  it('the service openPath refuses a locked path before the module router is asked', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { BINDING_FILE } = await import('../src/main/uniwork-docs/binding-store')
    const folder = join(dir, 'uniwork-documents', 'default', 'acc_1', 'doc_1')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'Plan.docx'), 'bytes')
    writeFileSync(join(folder, BINDING_FILE), JSON.stringify({ schema: 2 }))
    const path = join(folder, 'Plan.docx')
    const openPath = vi.fn(() => true)
    const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
    const handle = createUniworkDocs({ handle: vi.fn() } as never, {
      shellWindow: () => null,
      shellContents: () => null,
      openPath,
      refuseLockedPath: (p: string) => handle.service.refuseLockedPath(p),
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
    const shown = handle.service as unknown as { show(p: string, b: unknown): unknown }
    expect(() => shown.show(path, {})).toThrowError(
      expect.objectContaining({ code: 'engine_incompatible' }),
    )
    expect(openPath).not.toHaveBeenCalled()
    expect(handle.service.currentLocks()).toEqual([
      { path, reason: 'store_newer', name: 'Plan.docx' },
    ])
  })
})

describe('a sign-in as another account (GOA9-r3-04)', () => {
  it("closes the previous account's open documents and deletes their AI history", async () => {
    const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
    const root = join(dir, 'uniwork-documents')
    const previous = join(root, 'default', 'acc_a', 'doc_1', 'Sheet.xlsx')
    const own = join(root, 'default', 'acc_b', 'doc_2', 'Plan.docx')
    const local = join(dir, 'local.docx')
    const open = [local, previous, own]
    const closePath = vi.fn(async (path: string) => {
      open.splice(open.indexOf(path), 1)
      return true
    })
    const forgetAiHistory = vi.fn()
    const handle = createUniworkDocs({ handle: vi.fn() } as never, {
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
      openPaths: () => [...open],
      closePath,
      confirmClosePath: async () => true,
      closePathNow: () => undefined,
      aiHistoryPaths: () => [previous, own, local],
      forgetAiHistory,
    })
    handle.activate(() => undefined)
    identity = { accountId: 'acc_b', deviceSessionId: 'dev_2', deploymentId: 'default' }
    statusListener?.({ state: 'signed-in' })
    await vi.waitFor(() => expect(forgetAiHistory).toHaveBeenCalled())
    expect(closePath).toHaveBeenCalledTimes(1)
    expect(closePath).toHaveBeenCalledWith(previous)
    expect(open).toEqual([local, own])
    expect(forgetAiHistory).toHaveBeenCalledWith([previous])
  })
})

describe('G8-16 S16: the feed starts only for the chosen org (F-1)', () => {
  const ORGS = [
    { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' as const },
    { id: 'org_b', name: 'Beta', slug: 'beta', role: 'member', membership: 'active' as const },
  ]

  async function handle(send?: (channel: string, payload: unknown) => void) {
    const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
    const created = createUniworkDocs({ handle: vi.fn() } as never, {
      shellWindow: () => null,
      shellContents: () => (send ? ({ isDestroyed: () => false, send } as never) : null),
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

  it('a two-org account fetches nothing before the choice, then only the chosen org', async () => {
    await handle()
    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    // signed in with the picker up: the feed must not start at all; only the
    // public deployment config GET /api/v1/config may run (no org id, no token)
    statusNow = { loggedIn: true, state: 'signed-in', needsOrgChoice: true, orgs: ORGS }
    statusListener?.(statusNow)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetched.filter((path) => path !== '/api/v1/config')).toEqual([])
    for (const call of fetchedCalls) {
      expect(call.path).toBe('/api/v1/config')
      expect(call.url).not.toContain('org_a')
      expect(call.url).not.toContain('org_b')
      expect(call.headers.authorization).toBeUndefined()
      expect(JSON.stringify(call.headers)).not.toContain('fake-token')
      expect(JSON.stringify(call.headers)).not.toContain('org_')
    }

    // the choice's own status push starts the feed for that org alone
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: ORGS[0],
      orgs: ORGS,
    }
    statusListener?.(statusNow)
    await vi.waitFor(() => expect(fetched).toContain('/api/v1/orgs/org_a/office/capabilities'))
    expect(fetched.some((path) => path.includes('org_b'))).toBe(false)
  })

  it('an org change stops the old pass and starts the new org', async () => {
    await handle()
    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: ORGS[0],
      orgs: ORGS,
    }
    statusListener?.(statusNow)
    await vi.waitFor(() => expect(fetched).toContain('/api/v1/orgs/org_a/office/capabilities'))
    statusNow = { ...statusNow, org: ORGS[1] }
    statusListener?.(statusNow)
    await vi.waitFor(() => expect(fetched).toContain('/api/v1/orgs/org_b/office/capabilities'))
  })

  it('R3-05: forwards org changes through the status seam to suppress an in-flight own-action tree-changed push, while a same-org status push lets it through', async () => {
    const treeChangedPushes: Array<{ workspaceId: string }> = []
    const created = await handle((channel, payload) => {
      if (channel === UNIWORK_DOC_CHANNELS.treeChanged) {
        treeChangedPushes.push(payload as { workspaceId: string })
      }
    })
    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: ORGS[0],
      orgs: ORGS,
    }
    statusListener?.(statusNow)
    await vi.waitFor(() => expect(fetched).toContain('/api/v1/orgs/org_a/office/capabilities'))

    let postReached!: () => void
    let onPostReached = new Promise<void>((resolve) => {
      postReached = resolve
    })
    let releasePost!: () => void
    let postGate = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      fetched.push(path)
      if (path === '/api/v1/workspaces/ws_1/documents' && init?.method === 'POST') {
        postReached()
        await postGate
        return new Response(
          JSON.stringify({
            document: {
              id: 'fold_1',
              organization_id: 'org_a',
              workspace_id: 'ws_1',
              title: 'Folder',
              kind: 'folder',
              parent_id: null,
              revision: '1',
              current_version: 0,
              my_level: 'edit',
              updated_at: '2026-10-16T00:00:00Z',
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({
          sync_feed: false,
          sync_write: false,
          offline_library: false,
          ai_uniwork: false,
          ai_uniwork_formats: [],
          ttl_seconds: 300,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    // 1. Positive control: a status push reporting the same org does not suppress the push
    const firstCreate = created.service.createFolder({
      workspaceId: 'ws_1',
      parentId: null,
      title: 'Same org',
    })
    await onPostReached
    statusListener?.({ ...statusNow, org: ORGS[0] })
    releasePost()
    expect((await firstCreate).ok).toBe(true)
    await vi.waitFor(() => expect(treeChangedPushes).toEqual([{ workspaceId: 'ws_1' }]), {
      timeout: TREE_CHANGED_WINDOW_MS + 500,
    })

    // 2. Org switch via statusListener: suppresses the in-flight own-action push
    treeChangedPushes.length = 0
    onPostReached = new Promise<void>((resolve) => {
      postReached = resolve
    })
    postGate = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    vi.useFakeTimers()
    try {
      const secondCreate = created.service.createFolder({
        workspaceId: 'ws_1',
        parentId: null,
        title: 'Switched org',
      })
      await onPostReached
      statusNow = { ...statusNow, org: ORGS[1] }
      statusListener?.(statusNow)
      releasePost()
      expect((await secondCreate).ok).toBe(true)
      await vi.advanceTimersByTimeAsync(TREE_CHANGED_WINDOW_MS)
      expect(treeChangedPushes).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('sign-out stops the feed', async () => {
    await handle()
    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: ORGS[0],
      orgs: ORGS,
    }
    statusListener?.(statusNow)
    await vi.waitFor(() => expect(fetched).toContain('/api/v1/orgs/org_a/office/capabilities'))
    const seen = fetched.length
    identity = null
    statusNow = { loggedIn: false, state: 'signed-out' }
    statusListener?.(statusNow)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetched).toHaveLength(seen)
  })
})
