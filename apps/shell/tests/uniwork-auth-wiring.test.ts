import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
    getAppPath: () => '/app',
    getPath: () => '/user-data',
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

import { openAuthorizationUrl, registerAuthProtocols } from '../src/main/uniwork-auth'
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

describe('protocol registration', () => {
  it('registers both sign-in schemes, dev form with execPath + appPath', () => {
    registerAuthProtocols()
    expect(electron.app.setAsDefaultProtocolClient).toHaveBeenCalledWith(
      'uniwork-office',
      process.execPath,
      ['/app'],
    )
    expect(electron.app.setAsDefaultProtocolClient).toHaveBeenCalledWith(
      'uniwork-office-dev',
      process.execPath,
      ['/app'],
    )
    electron.app.isPackaged = true
    electron.app.setAsDefaultProtocolClient.mockClear()
    registerAuthProtocols()
    expect(electron.app.setAsDefaultProtocolClient.mock.calls).toEqual([
      ['uniwork-office'],
      ['uniwork-office-dev'],
    ])
  })
})
