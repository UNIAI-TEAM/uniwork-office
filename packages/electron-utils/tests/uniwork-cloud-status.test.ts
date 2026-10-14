// Read-only UniWork cloud status + account/org identity bridge for editor renderers (G6-05u S7/S8):
// shell main answers 'uniwork:cloud-status' and broadcasts 'uniwork:cloud-status-changed';
// each preload exposes window.uniworkCloudStatus { get, onChange, openAccountSettings, signIn }.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  UNIWORK_CLOUD_STATUS_BRIDGE_KEY,
  UNIWORK_CLOUD_STATUS_CHANGED,
  UNIWORK_CLOUD_STATUS_GET,
  UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT,
  UNIWORK_CLOUD_STATUS_SIGN_IN,
  answerUniworkCloudStatusOff,
  parseUniworkCloudStatusSnapshot,
  type UniworkCloudStatusSnapshot,
} from '../src/uniwork-cloud-status'
import { createUniworkCloudStatusBridge } from '../src/uniwork-cloud-status-bridge'

describe('uniwork-cloud-status bridge', () => {
  it('registers the pull channel in standalone mode and answers null (before first server read)', async () => {
    const handlers = new Map<string, () => unknown>()
    answerUniworkCloudStatusOff({ handle: (channel, fn) => void handlers.set(channel, fn) })
    expect([...handlers.keys()]).toEqual([UNIWORK_CLOUD_STATUS_GET])
    const answer = await handlers.get(UNIWORK_CLOUD_STATUS_GET)!()
    expect(answer).toBeNull()
    expect(parseUniworkCloudStatusSnapshot(answer)).toBeNull()
    expect(UNIWORK_CLOUD_STATUS_BRIDGE_KEY).toBe('uniworkCloudStatus')
  })

  it('parses valid cloud status snapshots and distinguishes cloud_unavailable from failed first reads', () => {
    expect(parseUniworkCloudStatusSnapshot(null)).toBeNull()
    expect(parseUniworkCloudStatusSnapshot(undefined)).toBeNull()
    expect(parseUniworkCloudStatusSnapshot('ready')).toBeNull()
    expect(parseUniworkCloudStatusSnapshot({ state: 'unknown-state' })).toBeNull()

    const ready = parseUniworkCloudStatusSnapshot({
      state: 'ready',
      signedIn: true,
      enabled: true,
      credits: {
        unit: 'ai.tokens',
        used: 180,
        limit: 500,
        remaining: 320,
        periodEnd: '2026-11-01T00:00:00Z',
      },
      accountId: 'acc_1',
      orgId: 'org_1',
      orgName: 'Công ty mẫu',
      email: 'user@example.com',
      planName: 'Pro',
    })
    expect(ready).toEqual({
      state: 'ready',
      signedIn: true,
      enabled: true,
      credits: {
        unit: 'ai.tokens',
        used: 180,
        limit: 500,
        remaining: 320,
        periodEnd: '2026-11-01T00:00:00Z',
      },
      reason: null,
      cloudUnavailable: false,
      accountId: 'acc_1',
      orgId: 'org_1',
      orgName: 'Công ty mẫu',
    })
    expect(ready).not.toHaveProperty('email')
    expect(ready).not.toHaveProperty('planName')

    const missingUsed = parseUniworkCloudStatusSnapshot({
      state: 'ready',
      signedIn: true,
      enabled: true,
      credits: {
        limit: 500,
        remaining: 320,
        periodEndsAt: '2026-12-01T00:00:00Z',
      },
    })
    expect(missingUsed?.credits).toEqual({
      unit: 'ai.tokens',
      used: null,
      limit: 500,
      remaining: 320,
      periodEnd: '2026-12-01T00:00:00Z',
    })

    const serverUnavailable = parseUniworkCloudStatusSnapshot({
      state: 'unavailable',
      signedIn: true,
      enabled: false,
      credits: null,
      reason: 'cloud_unavailable',
      accountId: 'acc_1',
      orgId: 'org_1',
      orgName: 'Công ty mẫu',
    })
    expect(serverUnavailable?.cloudUnavailable).toBe(true)
    expect(serverUnavailable?.reason).toBe('cloud_unavailable')

    const networkUnavailable = parseUniworkCloudStatusSnapshot({
      state: 'unavailable',
      signedIn: true,
      enabled: false,
      credits: null,
      reason: 'network',
    })
    expect(networkUnavailable?.cloudUnavailable).toBe(false)
    expect(networkUnavailable?.reason).toBe('network')
  })

  it('wires get, onChange, openAccountSettings and signIn through the preload bridge and warns on get IPC error', async () => {
    let current: UniworkCloudStatusSnapshot | null = null
    let failGet = false
    const invoked: string[] = []
    const listeners = new Set<(event: unknown, payload: unknown) => void>()

    const bridge = createUniworkCloudStatusBridge({
      invoke: async (channel) => {
        invoked.push(channel)
        if (channel === UNIWORK_CLOUD_STATUS_GET) {
          if (failGet) throw new Error('ipc channel failed')
          return current
        }
        return undefined
      },
      on: (channel, listener) => {
        if (channel === UNIWORK_CLOUD_STATUS_CHANGED) listeners.add(listener)
      },
      off: (channel, listener) => {
        if (channel === UNIWORK_CLOUD_STATUS_CHANGED) listeners.delete(listener)
      },
    })

    expect(await bridge.get()).toBeNull()

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    failGet = true
    expect(await bridge.get()).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
    failGet = false

    const seen: Array<UniworkCloudStatusSnapshot | null> = []
    const off = bridge.onChange((next) => seen.push(next))
    current = {
      state: 'signed-out',
      signedIn: false,
      enabled: false,
      credits: null,
    }
    for (const listener of listeners) listener({}, current)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.state).toBe('signed-out')

    await bridge.openAccountSettings()
    await bridge.signIn()
    expect(invoked).toEqual([
      UNIWORK_CLOUD_STATUS_GET,
      UNIWORK_CLOUD_STATUS_GET,
      UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT,
      UNIWORK_CLOUD_STATUS_SIGN_IN,
    ])

    off()
    expect(listeners.size).toBe(0)
  })

  it('every editor preload and the shell preload install the cloud status bridge', () => {
    const apps = join(__dirname, '../../../apps')
    for (const app of ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html', 'shell']) {
      const src = readFileSync(join(apps, app, 'src/preload/index.ts'), 'utf8')
      expect(src, `${app} preload`).toContain('installUniworkCloudStatusBridge()')
    }
  })

  it('every standalone editor main answers the cloud-status pull; the shell registers the real handler instead (RB1-5)', () => {
    const apps = join(__dirname, '../../../apps')
    for (const app of ['docs', 'sheets', 'slides', 'pdf', 'html', 'markdown']) {
      const src = readFileSync(join(apps, app, 'src/main', `${app}-main.ts`), 'utf8')
      const start = src.indexOf(`export function start`)
      expect(start, `${app} standalone start`).toBeGreaterThan(-1)
      expect(src.slice(start), `${app} standalone start answers the cloud-status pull`).toContain(
        'answerUniworkCloudStatusOff(ipcMain)',
      )
      expect(src.slice(0, start)).not.toContain('answerUniworkCloudStatusOff(')
    }
  })
})
