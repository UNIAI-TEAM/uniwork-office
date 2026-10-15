import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electron = vi.hoisted(() => ({
  userData: '/user-data',
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
    getAppPath: () => '/app',
    getPath: () => electron.userData,
    setAsDefaultProtocolClient: vi.fn(),
  },
  shell: { openExternal: vi.fn(async () => undefined) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text),
    decryptString: (buf: Buffer) => buf.toString(),
  },
}))
vi.mock('electron', () => electron)

import {
  accountCredentialStore,
  deviceInfo,
  openAuthorizationUrl,
  registerAuthProtocols,
} from '../src/main/uniwork-auth'
import {
  CredentialStoreError,
  createCredentialStore,
  type StoredCredential,
} from '../src/main/uniwork-auth/credentials'
import { EventEmitter } from 'node:events'
import { bindAuthCallbackEvents, createAuthCallbackRouter } from '../src/main/uniwork-auth/routing'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'

const stable: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  channel: 'stable',
}
const dev: DeploymentProfile = {
  ...stable,
  apiOrigin: 'http://localhost:8080',
  clientId: 'uniwork-office-dev',
  channel: 'dev',
}

beforeEach(() => {
  electron.shell.openExternal.mockClear()
  electron.app.setAsDefaultProtocolClient.mockClear()
  electron.app.isPackaged = false
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('authorization URL gate', () => {
  it('opens https URLs only', async () => {
    await openAuthorizationUrl('https://uniwork.example/auth/desktop/authorize?a=1', stable)
    expect(electron.shell.openExternal).toHaveBeenCalledWith(
      'https://uniwork.example/auth/desktop/authorize?a=1',
    )
    await expect(openAuthorizationUrl('http://localhost:8080/x', stable)).rejects.toThrow()
    await expect(openAuthorizationUrl('file:///etc/passwd', stable)).rejects.toThrow()
    await expect(openAuthorizationUrl('javascript:alert(1)', dev)).rejects.toThrow()
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('allows http loopback on the dev channel only', async () => {
    await openAuthorizationUrl('http://localhost:8080/auth/desktop/authorize', dev)
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1)
    await expect(openAuthorizationUrl('http://evil.example/x', dev)).rejects.toThrow()
  })

  it('skips the real browser behind the unpackaged E2E seam', async () => {
    vi.stubEnv('UNIWORK_AUTH_E2E_NO_BROWSER', '1')
    await openAuthorizationUrl('https://uniwork.example/a', stable)
    expect(electron.shell.openExternal).not.toHaveBeenCalled()
    electron.app.isPackaged = true
    await openAuthorizationUrl('https://uniwork.example/a', stable)
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1)
  })
})

describe('credential store E2E seam', () => {
  const credential: StoredCredential = {
    deploymentId: 'default',
    apiOrigin: 'https://uniwork.example',
    clientId: 'uniwork-office',
    accountId: 'acc_1',
    deviceSessionId: 'dev_1',
    sessionId: 'sess_1',
    refreshToken: 'rt_seam_secret_value',
    refreshExpiresAt: 1_900_000_000_000,
  }
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uniwork-store-seam-'))
    electron.userData = dir
  })
  afterEach(() => {
    electron.userData = '/user-data'
    rmSync(dir, { recursive: true, force: true })
  })
  const onDisk = () => existsSync(join(dir, 'uniwork-auth'))

  it('keeps the session in memory only when unpackaged and the env is set', () => {
    vi.stubEnv('UNIWORK_AUTH_E2E_PLAIN_STORE', '1')
    const store = accountCredentialStore()
    store.save(credential)
    expect(store.load()).toEqual(credential)
    expect(onDisk()).toBe(false)
    // a restart (a new store) forgets it
    expect(accountCredentialStore().load()).toBeNull()
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('uses the real keyring-backed store without the env', () => {
    const store = accountCredentialStore()
    store.save(credential)
    expect(onDisk()).toBe(true)
    expect(accountCredentialStore().load()).toEqual(credential)
  })

  it('ignores the env in a packaged build', () => {
    vi.stubEnv('UNIWORK_AUTH_E2E_PLAIN_STORE', '1')
    electron.app.isPackaged = true
    accountCredentialStore().save(credential)
    expect(onDisk()).toBe(true)
  })
})

describe('protocol registration', () => {
  it('registers only the active channel scheme, dev form with execPath + appPath', () => {
    registerAuthProtocols(dev)
    expect(electron.app.setAsDefaultProtocolClient.mock.calls).toEqual([
      ['uniwork-office-dev', process.execPath, ['/app']],
    ])
    electron.app.isPackaged = true
    electron.app.setAsDefaultProtocolClient.mockClear()
    registerAuthProtocols(stable)
    expect(electron.app.setAsDefaultProtocolClient.mock.calls).toEqual([['uniwork-office']])
  })

  it('registers nothing without a deployment profile', () => {
    registerAuthProtocols(null)
    expect(electron.app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })
})

describe('device metadata', () => {
  it('names the platform the way the consent page shows it', () => {
    expect(deviceInfo('win32', '1.2.3')).toEqual({
      label: 'UniWork Office (Windows)',
      platform: 'windows',
      build: '1.2.3',
    })
    expect(deviceInfo('darwin', '1').platform).toBe('macos')
    expect(deviceInfo('linux', '1')).toMatchObject({
      platform: 'linux',
      label: 'UniWork Office (Linux)',
    })
  })
})

describe('sign-in callback routing', () => {
  const callback = 'uniwork-office://auth/callback?code=c&state=s'

  it('holds a cold-start argv callback until the account starts', () => {
    const router = createAuthCallbackRouter(['electron.exe', '.', callback])
    expect(router.pending()).toBe(callback)
    const route = vi.fn()
    router.start(route)
    expect(route).toHaveBeenCalledWith(callback)
    expect(router.pending()).toBeNull()
  })

  it('queues open-url before ready and routes directly afterwards', () => {
    const router = createAuthCallbackRouter(['electron.exe'])
    expect(router.openUrl(callback)).toBe(true)
    expect(router.openUrl('uniwork://open?token=t')).toBe(false)
    expect(router.pending()).toBe(callback)
    const route = vi.fn()
    router.start(route)
    expect(route.mock.calls).toEqual([[callback]])
    const later = 'uniwork-office://auth/callback?code=d&state=s'
    expect(router.openUrl(later)).toBe(true)
    expect(route.mock.calls).toEqual([[callback], [later]])
  })

  it('routes a second instance callback from argv first, then lock data', () => {
    const router = createAuthCallbackRouter([])
    const route = vi.fn()
    router.start(route)
    const fromLock = 'uniwork-office-dev://auth/callback?code=l&state=s'
    expect(router.secondInstance(['electron.exe', callback], { authCallbackUrl: fromLock })).toBe(
      true,
    )
    expect(router.secondInstance(['electron.exe'], { authCallbackUrl: fromLock })).toBe(true)
    expect(router.secondInstance(['electron.exe'], { launchUrl: 'uniwork://open?x=1' })).toBe(false)
    expect(router.secondInstance(['electron.exe', 'C:/doc.docx'], {})).toBe(false)
    expect(route.mock.calls).toEqual([[callback], [fromLock]])
  })
})

describe('sign-in callback app events', () => {
  const callback = 'uniwork-office://auth/callback?code=c&state=s'

  function bound() {
    const app = new EventEmitter()
    const router = createAuthCallbackRouter([])
    const route = vi.fn()
    router.start(route)
    const fallback = { openUrl: vi.fn(), secondInstance: vi.fn() }
    bindAuthCallbackEvents(app, router, fallback)
    return { app, route, fallback }
  }

  it('open-url: a sign-in callback goes to the account, anything else to the fallback', () => {
    const { app, route, fallback } = bound()
    const event = { preventDefault: vi.fn() }
    app.emit('open-url', event, callback)
    app.emit('open-url', event, 'uniwork://office/app?kind=docs')
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(route.mock.calls).toEqual([[callback]])
    expect(fallback.openUrl.mock.calls).toEqual([['uniwork://office/app?kind=docs']])
  })

  it('second-instance: a sign-in callback is consumed, files and bridge URLs fall through', () => {
    const { app, route, fallback } = bound()
    app.emit('second-instance', {}, ['electron.exe', callback], '/cwd', {})
    app.emit('second-instance', {}, ['electron.exe', 'C:/doc.docx'], '/cwd', { x: 1 })
    expect(route.mock.calls).toEqual([[callback]])
    expect(fallback.secondInstance.mock.calls).toEqual([
      [['electron.exe', 'C:/doc.docx'], { x: 1 }],
    ])
  })
})

describe('credential store wiring', () => {
  const credential: StoredCredential = {
    deploymentId: 'default',
    apiOrigin: 'https://uniwork.example',
    clientId: 'uniwork-office',
    accountId: 'acc_1',
    deviceSessionId: 'dev_1',
    sessionId: 'sess_1',
    refreshToken: 'rt_1',
    refreshExpiresAt: 1_900_000_000_000,
  }
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uw-wiring-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('a locked OS keychain surfaces as keystore_locked through the real store', () => {
    const writer = createCredentialStore({ userDataDir: dir, safeStorage: electron.safeStorage })
    writer.save(credential)
    const original = electron.safeStorage.decryptString
    electron.safeStorage.decryptString = () => {
      throw new Error('keychain access denied')
    }
    try {
      const store = createCredentialStore({ userDataDir: dir, safeStorage: electron.safeStorage })
      try {
        store.load()
        expect.unreachable()
      } catch (error) {
        expect((error as CredentialStoreError).code).toBe('keystore_locked')
      }
    } finally {
      electron.safeStorage.decryptString = original
    }
  })
})
