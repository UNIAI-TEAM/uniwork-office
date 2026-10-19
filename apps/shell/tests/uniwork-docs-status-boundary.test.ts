import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS, type AccountStatus } from '../src/shared/home-api'
import { TREE_CHANGED_WINDOW_MS } from '../src/main/uniwork-docs/tree-changed'

/**
 * FD-13 BE (carried from FD-11 r6: R6-01, R6-02):
 * End-to-end verification of the account-status callback in
 * `apps/shell/src/main/uniwork-docs/wiring.ts` (`onUniworkAccountStatus` ->
 * `service.noteSelectedOrg(status.org?.id ?? null, status.orgsError === undefined)`
 * -> `pushTreeChangedFor` -> `treeChanged` coalescer) while a real own folder
 * action (`createFolder`) is gated in flight.
 */

const WS = 'ws_1'
const ORGS = [
  { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' as const },
  { id: 'org_b', name: 'Beta', slug: 'beta', role: 'member', membership: 'active' as const },
]

let dir: string
let statusListener: ((status: AccountStatus) => void) | null = null
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null
let statusNow: AccountStatus = { loggedIn: false, state: 'signed-out' }
let fetched: string[] = []

vi.mock('electron', () => ({
  app: { getPath: () => dir, configureHostResolver: () => undefined },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`ENC1${text}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
  session: {
    defaultSession: {
      setSpellCheckerDictionaryDownloadURL: () => undefined,
      getSpellCheckerLanguages: () => ['en-US'],
      setSpellCheckerLanguages: () => undefined,
      isSpellCheckerEnabled: () => true,
      setSpellCheckerEnabled: () => undefined,
    },
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

/** a one-shot latch: `reached` fires when the code hits it, `release` opens it */
function latch() {
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  return { held, release, reached, entered }
}

const capabilitiesResponse = () =>
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
  )

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-status-boundary-'))
  statusListener = null
  identity = null
  statusNow = { loggedIn: false, state: 'signed-out' }
  fetched = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    fetched.push(new URL(String(input)).pathname)
    return Promise.resolve(capabilitiesResponse())
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

async function createActivatedWiring(onTreeChanged: (payload: { workspaceId: string }) => void) {
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const created = createUniworkDocs({ handle: vi.fn() } as never, {
    shellWindow: () => null,
    shellContents: () =>
      ({
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => {
          if (channel === UNIWORK_DOC_CHANNELS.treeChanged) {
            onTreeChanged(payload as { workspaceId: string })
          }
        },
      }) as never,
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

function stubGatedFolderPost(postGate: ReturnType<typeof latch>, orgId = 'org_a') {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    fetched.push(path)
    if (path === `/api/v1/workspaces/${WS}/documents` && init?.method === 'POST') {
      postGate.entered()
      await postGate.held
      return new Response(
        JSON.stringify({
          document: {
            id: 'fold_1',
            organization_id: orgId,
            workspace_id: WS,
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
    return capabilitiesResponse()
  })
}

describe('status-callback session boundaries for in-flight folder actions (R6-01, R6-02)', () => {
  it('R6-01: a lasting org-less status (orgs empty, no orgsError) through the wiring callback bumps the session epoch and suppresses an in-flight action push', async () => {
    const treeChangedPushes: Array<{ workspaceId: string }> = []
    const created = await createActivatedWiring((payload) => treeChangedPushes.push(payload))
    expect(statusListener).not.toBeNull()

    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: ORGS[0],
      orgs: [ORGS[0]],
    }
    statusListener?.(statusNow)

    const postGate = latch()
    stubGatedFolderPost(postGate)

    vi.useFakeTimers()
    const createPromise = created.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Lasting org-less folder',
    })
    await postGate.reached

    // Deliver a lasting org-less status (orgs empty, orgsError absent) through
    // the real wiring callback while the folder creation request is in flight.
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      orgs: [],
    }
    statusListener?.(statusNow)

    postGate.release()
    const result = await createPromise
    expect(result.ok).toBe(true)

    await vi.advanceTimersByTimeAsync(TREE_CHANGED_WINDOW_MS)
    expect(treeChangedPushes).toEqual([])
  })

  it('R6-02 (A -> transient null -> A): a transient org-less status (orgsError set) keeps the org latch so recovering to A still pushes treeChanged', async () => {
    const treeChangedPushes: Array<{ workspaceId: string }> = []
    const created = await createActivatedWiring((payload) => treeChangedPushes.push(payload))
    expect(statusListener).not.toBeNull()

    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: ORGS[0],
      orgs: ORGS,
    }
    statusListener?.(statusNow)

    const postGate = latch()
    stubGatedFolderPost(postGate)

    vi.useFakeTimers()
    const createPromise = created.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Transient org-less then same org A',
    })
    await postGate.reached

    // Transient /orgs failure (orgsError set) followed by recovery to the same org A
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: true,
      orgsError: 'network',
    }
    statusListener?.(statusNow)
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: ORGS[0],
      orgs: ORGS,
    }
    statusListener?.(statusNow)

    postGate.release()
    const result = await createPromise
    expect(result.ok).toBe(true)

    await vi.advanceTimersByTimeAsync(TREE_CHANGED_WINDOW_MS)
    expect(treeChangedPushes).toEqual([{ workspaceId: WS }])
  })

  it('R6-02 (A -> transient null -> B): a transient org-less status (orgsError set) followed by org B bumps the epoch and suppresses the in-flight action started under A', async () => {
    const treeChangedPushes: Array<{ workspaceId: string }> = []
    const created = await createActivatedWiring((payload) => treeChangedPushes.push(payload))
    expect(statusListener).not.toBeNull()

    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: ORGS[0],
      orgs: ORGS,
    }
    statusListener?.(statusNow)

    const postGate = latch()
    stubGatedFolderPost(postGate)

    vi.useFakeTimers()
    const createPromise = created.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Transient org-less then different org B',
    })
    await postGate.reached

    // Transient /orgs failure (orgsError set) followed by a switch to org B:
    // the transient null must not clear the org_a latch or swallow the A -> B boundary.
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: true,
      orgsError: 'network',
    }
    statusListener?.(statusNow)
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: ORGS[1],
      orgs: ORGS,
    }
    statusListener?.(statusNow)

    postGate.release()
    const result = await createPromise
    expect(result.ok).toBe(true)

    await vi.advanceTimersByTimeAsync(TREE_CHANGED_WINDOW_MS)
    expect(treeChangedPushes).toEqual([])
  })
})
