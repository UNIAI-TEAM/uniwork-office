// Main-side UniWork cloud status IPC + shell wiring tests (G6-05u S7/S8, RB1-1/4/7/8/9):
// verifies registerUniworkCloudStatusIpc, broadcastUniworkCloudStatus, senderFrame validation,
// null-before-first-read, switch-to-Home hook order on "Chi tiết" / unconfigured sign-in,
// email/planName omission on the broadcast snapshot, and console.warn on broadcast failure.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UNIWORK_CLOUD_STATUS_CHANGED,
  UNIWORK_CLOUD_STATUS_GET,
  UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT,
  UNIWORK_CLOUD_STATUS_SIGN_IN,
  type UniworkCloudStatusSnapshot,
} from '@genoffice/electron-utils/uniwork-ai-flag'
import { HOME_CHANNELS } from '../src/shared/home-api'

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
    getAppPath: () => '/app',
    getPath: () => '/tmp/uniwork-cloud-status-test',
    setAsDefaultProtocolClient: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
  },
  net: {
    isOnline: () => true,
  },
  shell: {
    openExternal: vi.fn(async () => undefined),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text),
    decryptString: (buf: Buffer) => buf.toString(),
  },
  webContents: {
    getAllWebContents: vi.fn((): unknown[] => []),
  },
}))
vi.mock('electron', () => electron)

import {
  broadcastUniworkCloudStatus,
  registerUniworkCloudStatusIpc,
} from '../src/main/uniwork-cloud-status'
import {
  configureUniworkAccount,
  currentUniworkCloudStatusSnapshot,
  registerAccountIpc,
  stopUniworkAccount,
  uniworkAccount,
  uniworkCloud,
} from '../src/main/uniwork-auth'

function mainFrameEvent(frame: object = {}) {
  return {
    sender: {
      isDestroyed: () => false,
      mainFrame: frame,
      once: vi.fn(),
    },
    senderFrame: frame,
  }
}

function forgedSubframeEvent() {
  return {
    sender: {
      isDestroyed: () => false,
      mainFrame: { id: 'main' },
      once: vi.fn(),
    },
    senderFrame: { id: 'subframe' },
  }
}

describe('uniwork-cloud-status main IPC (RB1-7, RB1-8)', () => {
  it('answers get, openAccountSettings, and signIn for main-frame callers and rejects forged subframes (RB1-7)', async () => {
    const handlers = new Map<string, (event: unknown) => unknown>()
    let snapshot: UniworkCloudStatusSnapshot | null = null
    const openAccountSettings = vi.fn()
    const signIn = vi.fn()

    registerUniworkCloudStatusIpc(
      {
        handle: (channel, listener) => {
          handlers.set(channel, listener as (event: unknown) => unknown)
        },
      },
      {
        get: () => snapshot,
        openAccountSettings,
        signIn,
      },
    )

    // Null before first read
    expect(await handlers.get(UNIWORK_CLOUD_STATUS_GET)!(mainFrameEvent())).toBeNull()

    snapshot = {
      state: 'not-entitled',
      signedIn: true,
      enabled: false,
      credits: null,
      reason: null,
      cloudUnavailable: false,
      accountId: 'acc_1',
      orgId: 'org_1',
      orgName: 'Org One',
    }
    expect(await handlers.get(UNIWORK_CLOUD_STATUS_GET)!(mainFrameEvent())).toEqual(snapshot)

    // Forged senderFrame is rejected across all three channels (RB1-7)
    expect(await handlers.get(UNIWORK_CLOUD_STATUS_GET)!(forgedSubframeEvent())).toBeNull()
    await handlers.get(UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT)!(forgedSubframeEvent())
    await handlers.get(UNIWORK_CLOUD_STATUS_SIGN_IN)!(forgedSubframeEvent())
    expect(openAccountSettings).not.toHaveBeenCalled()
    expect(signIn).not.toHaveBeenCalled()

    // Main-frame caller succeeds
    await handlers.get(UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT)!(mainFrameEvent())
    await handlers.get(UNIWORK_CLOUD_STATUS_SIGN_IN)!(mainFrameEvent())
    expect(openAccountSettings).toHaveBeenCalledTimes(1)
    expect(signIn).toHaveBeenCalledTimes(1)
  })

  it('broadcast skips destroyed webContents and sends to live ones (RB1-8)', () => {
    const sent: unknown[] = []
    const snap: UniworkCloudStatusSnapshot = {
      state: 'ready',
      signedIn: true,
      enabled: true,
      credits: { unit: 'ai.tokens', used: 10, limit: 100, remaining: 90, periodEnd: null },
    }
    broadcastUniworkCloudStatus(snap, [
      { isDestroyed: () => true, send: () => sent.push('destroyed') },
      { isDestroyed: () => false, send: (c: string, p: unknown) => sent.push([c, p]) },
    ] as never)
    expect(sent).toEqual([[UNIWORK_CLOUD_STATUS_CHANGED, snap]])
  })
})

describe('shell account + cloud status integration (RB1-1, RB1-4, RB1-8, RB1-9)', () => {
  let dir: string
  let settingsFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uw-cloud-ipc-'))
    settingsFile = join(dir, 'app-settings.json')
    writeFileSync(settingsFile, JSON.stringify({}))
    electron.app.getPath = () => dir
    electron.webContents.getAllWebContents.mockReset()
    electron.webContents.getAllWebContents.mockReturnValue([])
    configureUniworkAccount({ settingsPath: () => settingsFile })
  })

  afterEach(() => {
    stopUniworkAccount()
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null before the first cloud read and a PII-free snapshot after refresh (RB1-4, RB1-8)', async () => {
    const cloud = uniworkCloud()
    expect(cloud.hasCompletedRead()).toBe(false)
    expect(currentUniworkCloudStatusSnapshot()).toBeNull()

    await cloud.refresh()
    expect(cloud.hasCompletedRead()).toBe(true)
    const snap = currentUniworkCloudStatusSnapshot()
    expect(snap).not.toBeNull()
    expect(snap?.state).toBe('signed-out')
    expect(snap?.signedIn).toBe(false)
    expect(snap).not.toHaveProperty('email')
    expect(snap).not.toHaveProperty('planName')
  })

  it('calls the injected openHomeTab hook BEFORE sending openSettings on "Chi tiết" and unconfigured "Đăng nhập" (RB1-1)', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const callOrder: string[] = []
    const shellWc = {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        callOrder.push(`${channel}:${JSON.stringify(payload)}`)
      },
    }

    registerAccountIpc(
      {
        handle: (channel, listener) => {
          handlers.set(channel, listener as (event: unknown, ...args: unknown[]) => unknown)
        },
      } as never,
      () => shellWc as never,
      () => {
        callOrder.push('openHomeTab')
      },
    )

    // 1. "Chi tiết" (UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT) switches to Home before sending settings events
    await handlers.get(UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT)!(mainFrameEvent())
    expect(callOrder).toEqual([
      'openHomeTab',
      `${HOME_CHANNELS.openSettings}:${JSON.stringify({ section: 'account' })}`,
      `${HOME_CHANNELS.openSettingsEvent}:${JSON.stringify('account')}`,
    ])

    // 2. "Đăng nhập" (UNIWORK_CLOUD_STATUS_SIGN_IN) when account state is not-configured also switches to Home first
    callOrder.length = 0
    expect(uniworkAccount().status().state).toBe('not-configured')
    await handlers.get(UNIWORK_CLOUD_STATUS_SIGN_IN)!(mainFrameEvent())
    expect(callOrder).toEqual([
      'openHomeTab',
      `${HOME_CHANNELS.openSettings}:${JSON.stringify({ section: 'account' })}`,
      `${HOME_CHANNELS.openSettingsEvent}:${JSON.stringify('account')}`,
    ])
  })

  it('logs console.warn when webContents broadcast throws during status notification (RB1-9)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    electron.webContents.getAllWebContents.mockReturnValue([
      {
        isDestroyed: () => false,
        send: () => {
          throw new Error('webContents send failed')
        },
      },
    ])

    const account = uniworkAccount()
    await account.logout()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
