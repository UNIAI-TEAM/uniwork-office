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

let spellLanguages = ['en-US', 'fr']
let spellAvailable: string[] | undefined = ['en-US', 'fr', 'de-DE']
let spellEnabled = true

const electronMocks = vi.hoisted(() => ({
  configureHostResolver: vi.fn(),
  setSpellCheckerDictionaryDownloadURL: vi.fn(),
  getSpellCheckerLanguages: vi.fn(() => [...spellLanguages]),
  setSpellCheckerLanguages: vi.fn((langs: string[]) => {
    spellLanguages = [...langs]
    // Mirror Electron/Chromium native SpellcheckService::OnSpellCheckDictionariesChanged:
    // setting a non-empty list enables spellcheck, setting [] disables it.
    spellEnabled = langs.length > 0
  }),
  isSpellCheckerEnabled: vi.fn(() => spellEnabled),
  setSpellCheckerEnabled: vi.fn((enabled: boolean) => {
    spellEnabled = enabled
  }),
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
      get availableSpellCheckerLanguages() {
        return spellAvailable as string[]
      },
      getSpellCheckerLanguages: electronMocks.getSpellCheckerLanguages,
      setSpellCheckerLanguages: electronMocks.setSpellCheckerLanguages,
      isSpellCheckerEnabled: electronMocks.isSpellCheckerEnabled,
      setSpellCheckerEnabled: electronMocks.setSpellCheckerEnabled,
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
  spellLanguages = ['en-US', 'fr']
  spellAvailable = ['en-US', 'fr', 'de-DE']
  spellEnabled = true
  electronMocks.configureHostResolver.mockClear()
  electronMocks.setSpellCheckerDictionaryDownloadURL.mockClear()
  electronMocks.getSpellCheckerLanguages.mockClear()
  electronMocks.setSpellCheckerLanguages.mockClear()
  electronMocks.isSpellCheckerEnabled.mockClear()
  electronMocks.setSpellCheckerEnabled.mockClear()
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

    // Initially signed out -> dictionary download URL set to local unreachable URL at whenReady; no reload
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(1)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith(
      'file:///nonexistent/',
    )
    expect(electronMocks.setSpellCheckerLanguages).not.toHaveBeenCalled()

    // Redundant signed-out status push does not re-apply or reload
    statusListener?.({ loggedIn: false, state: 'signed-out' })
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(1)
    expect(electronMocks.setSpellCheckerLanguages).not.toHaveBeenCalled()

    // Sign in (blocked -> allowed) -> restored to Chromium default CDN URL and reloads selected languages once
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
    expect(electronMocks.setSpellCheckerLanguages.mock.calls).toEqual([[[]], [['en-US', 'fr']]])
    expect(spellLanguages).toEqual(['en-US', 'fr'])
    expect(spellEnabled).toBe(true)
    expect(electronMocks.setSpellCheckerEnabled).not.toHaveBeenCalled()

    // Redundant signed-in status push does not re-apply or reload again
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(2)
    expect(electronMocks.setSpellCheckerLanguages).toHaveBeenCalledTimes(2)

    // BE-1: routine in-session token refresh (signed-in -> refreshing -> signed-in)
    // blocks and restores the download URL as before, but does NOT reload dictionaries again
    statusNow = {
      loggedIn: true,
      state: 'refreshing',
      needsOrgChoice: false,
      org: { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' },
      orgs: [{ id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' }],
    }
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(3)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith(
      'file:///nonexistent/',
    )
    expect(electronMocks.setSpellCheckerLanguages).toHaveBeenCalledTimes(2)

    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' },
      orgs: [{ id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' }],
    }
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(4)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith(
      'https://redirector.gvt1.com/edgedl/chrome/dict/',
    )
    expect(electronMocks.setSpellCheckerLanguages).toHaveBeenCalledTimes(2)

    // Sign out again (allowed -> blocked) -> blocked again with local unreachable URL; no reload
    identity = null
    statusNow = { loggedIn: false, state: 'signed-out' }
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(5)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith(
      'file:///nonexistent/',
    )
    expect(electronMocks.setSpellCheckerLanguages).toHaveBeenCalledTimes(2)

    // Real sign-in after a real sign-out DOES reload dictionaries again
    identity = { accountId: 'acc_1', deviceSessionId: 'dev_2', deploymentId: 'default' }
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' },
      orgs: [{ id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' }],
    }
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(6)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith(
      'https://redirector.gvt1.com/edgedl/chrome/dict/',
    )
    expect(electronMocks.setSpellCheckerLanguages).toHaveBeenCalledTimes(4)
    expect(electronMocks.setSpellCheckerLanguages.mock.calls.slice(2)).toEqual([
      [[]],
      [['en-US', 'fr']],
    ])
  })

  it('reloads dictionaries once when startup restore begins in refreshing at activation and then reaches signed-in', async () => {
    statusNow = { loggedIn: true, state: 'refreshing' }
    await activateWiring()

    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledTimes(1)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith(
      'file:///nonexistent/',
    )
    expect(electronMocks.setSpellCheckerLanguages).not.toHaveBeenCalled()

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
    expect(electronMocks.setSpellCheckerLanguages.mock.calls).toEqual([[[]], [['en-US', 'fr']]])

    // Subsequent proactive refresh during the restored session does not reload again
    statusNow = { ...statusNow, state: 'refreshing' }
    statusListener?.(statusNow)
    statusNow = { ...statusNow, state: 'signed-in' }
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerLanguages).toHaveBeenCalledTimes(2)
  })

  it('preserves spellchecker disabled state across the blocked -> allowed dictionary reload and skips reload when no languages are selected', async () => {
    spellLanguages = ['de-DE']
    spellEnabled = false
    await activateWiring()

    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusNow = { loggedIn: true, state: 'signed-in' }
    statusListener?.(statusNow)

    expect(electronMocks.setSpellCheckerLanguages.mock.calls).toEqual([[[]], [['de-DE']]])
    expect(electronMocks.setSpellCheckerEnabled).toHaveBeenCalledTimes(1)
    expect(electronMocks.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
    expect(spellLanguages).toEqual(['de-DE'])
    expect(spellEnabled).toBe(false)

    // Sign out, clear languages (e.g. macOS native checker / empty language list), sign in again -> no-op reload
    identity = null
    statusNow = { loggedIn: false, state: 'signed-out' }
    statusListener?.(statusNow)
    electronMocks.setSpellCheckerLanguages.mockClear()
    electronMocks.setSpellCheckerEnabled.mockClear()
    spellLanguages = []

    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusNow = { loggedIn: true, state: 'signed-in' }
    statusListener?.(statusNow)

    expect(electronMocks.setSpellCheckerLanguages).not.toHaveBeenCalled()
    expect(electronMocks.setSpellCheckerEnabled).not.toHaveBeenCalled()
  })

  it('filters stale languages through availableSpellCheckerLanguages and catches throwing spellcheck calls without aborting the status listener', async () => {
    spellLanguages = ['en-US', 'xx-STALE']
    spellAvailable = ['en-US', 'fr']
    const created = await activateWiring()
    const onSignedInSpy = vi.spyOn(created.service.launch, 'onSignedIn')

    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' },
      orgs: [{ id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' }],
    }
    statusListener?.(statusNow)

    // Only the valid available language ('en-US') is restored; 'xx-STALE' is filtered out
    expect(electronMocks.setSpellCheckerLanguages.mock.calls).toEqual([[[]], [['en-US']]])
    expect(spellLanguages).toEqual(['en-US'])

    // If all languages in preferences are stale, reload is skipped completely
    identity = null
    statusNow = { loggedIn: false, state: 'signed-out' }
    statusListener?.(statusNow)
    electronMocks.setSpellCheckerLanguages.mockClear()
    spellLanguages = ['xx-STALE']

    identity = { accountId: 'acc_1', deviceSessionId: 'dev_2', deploymentId: 'default' }
    statusNow = { loggedIn: true, state: 'signed-in' }
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerLanguages).not.toHaveBeenCalled()

    // Sign out, then make setSpellCheckerLanguages throw on sign-in:
    // listener must not abort (onSignedIn, signedIn state, and feed start still run)
    identity = null
    statusNow = { loggedIn: false, state: 'signed-out' }
    statusListener?.(statusNow)
    spellLanguages = ['en-US']
    onSignedInSpy.mockClear()
    const fetchSpy = vi.fn(() =>
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
    vi.stubGlobal('fetch', fetchSpy)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    electronMocks.setSpellCheckerLanguages.mockImplementationOnce(() => {
      throw new Error('Invalid language code provided: /secret/local/path')
    })

    identity = { accountId: 'acc_1', deviceSessionId: 'dev_3', deploymentId: 'default' }
    statusNow = {
      loggedIn: true,
      state: 'signed-in',
      needsOrgChoice: false,
      org: { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' },
      orgs: [{ id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', membership: 'active' }],
    }
    expect(() => statusListener?.(statusNow)).not.toThrow()
    expect(onSignedInSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      'uniwork docs: spellcheck dictionary gate failed:',
      'Error',
    )
    // Redundant signed-in push confirms signedIn was updated to true despite the throw
    electronMocks.setSpellCheckerDictionaryDownloadURL.mockClear()
    statusListener?.(statusNow)
    expect(electronMocks.setSpellCheckerDictionaryDownloadURL).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
