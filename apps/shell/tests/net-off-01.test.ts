import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStatus } from '../src/shared/home-api'

/**
 * NET-OFF-01 (UNI-1387): No network from the desktop app while signed out.
 * Verifies through the real `createUniworkDocs(...).activate(...)` wiring:
 * 1. `app.configureHostResolver({ secureDnsMode: 'off' })` is called once at startup.
 * 2. When signed out, `session.defaultSession.setSpellCheckerDictionaryDownloadURL` is
 *    called with the local unreachable URL (`file:///nonexistent/`).
 * 3. When the user signs in, the dictionary download URL is restored to the Chromium
 *    default (`https://redirector.gvt1.com/edgedl/chrome/dict/`).
 * 4. When the user signs out again, the dictionary download URL is blocked again.
 */

let dir: string
let statusListener: ((status: AccountStatus) => void) | null = null
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null
let statusNow: AccountStatus = { loggedIn: false, state: 'signed-out' }

const electronMocks = vi.hoisted(() => ({
  configureHostResolver: vi.fn(),
  setSpellCheckerDictionaryDownloadURL: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => dir,
    configureHostResolver: electronMocks.configureHostResolver,
  },
  BrowserWindow: { getFocusedWindow: () => null },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`ENC1${text}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
  session: {
    defaultSession: {
      setSpellCheckerDictionaryDownloadURL: electronMocks.setSpellCheckerDictionaryDownloadURL,
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-net-off-01-'))
  statusListener = null
  identity = null
  statusNow = { loggedIn: false, state: 'signed-out' }
  electronMocks.configureHostResolver.mockClear()
  electronMocks.setSpellCheckerDictionaryDownloadURL.mockClear()
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
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
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

async function runStartupWhenReady() {
  const {
    applySpellcheckDictionaryDownloadGate,
    configureStartupHostResolver,
    resetStartupHostResolverForTest,
  } = await import('../src/main/uniwork-docs/wiring')
  resetStartupHostResolverForTest()
  // The first two lines of app.whenReady().then(...) in apps/shell/src/main/index.ts:
  configureStartupHostResolver()
  applySpellcheckDictionaryDownloadGate(false)
}

async function activateWiring() {
  await runStartupWhenReady()
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const created = createUniworkDocs({ handle: vi.fn() } as never, {
    shellWindow: () => null,
    shellContents: () => null,
    openPath: () => true,
    refuseLockedPath: () => false,
    isPathOpen: () => false,
    requestModuleSave: () => false,
    reloadPath: () => undefined,
    editorStateOf: async () => ({ dirty: null, aiRunning: false, aiEpoch: 0 }),
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
    notifyPathRenamed: () => undefined,
  })
  created.activate(() => undefined)
  return created
}

describe('NET-OFF-01: signed-out network suppression (secure DNS + spellcheck dictionary download)', () => {
  it('blocks spellcheck dictionary downloads and disables secure DNS at startup even when activate never runs', async () => {
    const { readFileSync } = await import('node:fs')
    const indexSrc = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8')
    expect(indexSrc).toMatch(
      /app\.whenReady\(\)\.then\(async \(\) => \{\s*configureStartupHostResolver\(\)\s*applySpellcheckDictionaryDownloadGate\(false\)/,
    )

    await runStartupWhenReady()

    expect(electronMocks.configureHostResolver).toHaveBeenCalledTimes(1)
    expect(electronMocks.configureHostResolver).toHaveBeenCalledWith({ secureDnsMode: 'off' })
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(1)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith(
      'file:///nonexistent/',
    )
  })

  it('disables secure DNS once at startup and gates spellcheck dictionary downloads on signedIn transitions', async () => {
    await activateWiring()

    expect(electronMocks.configureHostResolver).toHaveBeenCalledTimes(1)
    expect(electronMocks.configureHostResolver).toHaveBeenCalledWith({ secureDnsMode: 'off' })

    // Initially signed out -> dictionary download URL set to local unreachable URL at whenReady
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(1)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith(
      'file:///nonexistent/',
    )

    // Redundant signed-out status push does not re-apply
    statusListener?.({ loggedIn: false, state: 'signed-out' })
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(1)

    // Sign in -> restored to Chromium default CDN URL
    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' },
      orgs: [{ id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' }],
    }
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(2)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith(
      'https://redirector.gvt1.com/edgedl/chrome/dict/',
    )

    // Redundant signed-in status push does not re-apply
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(2)

    // Sign out again -> blocked again with local unreachable URL
    identity = null
    statusNow = { loggedIn: false, state: 'signed-out' }
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(3)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith(
      'file:///nonexistent/',
    )
  })
})
