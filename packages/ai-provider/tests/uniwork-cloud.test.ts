import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UNIWORK_CLOUD_SIGNED_OUT,
  UniworkCloudError,
  getUniworkCloudStatus,
  normalizeUniworkCloudStatus,
  onUniworkCloudStatus,
  refreshUniworkCloudStatus,
  refreshUniworkCloudStatusIfNotReady,
  setUniworkCloudRefresher,
  setUniworkCloudStatus,
  setUniworkCloudTransport,
  uniworkCloudEnabled,
  uniworkCloudToolAvailable,
  uniworkCloudTransport,
} from '../src/uniwork-cloud'
import { cloudToolsEnabled } from '../src/providers'

afterEach(() => {
  setUniworkCloudStatus(UNIWORK_CLOUD_SIGNED_OUT)
  setUniworkCloudTransport(null)
  setUniworkCloudRefresher(null)
  vi.useRealTimers()
})

const tools = {
  web_search: true,
  image_search: false,
  image_generate: true,
  media_analyze: true,
  transcribe: true,
}

describe('UniWork cloud seam', () => {
  it('starts signed out: nothing enabled, no transport', () => {
    expect(getUniworkCloudStatus().state).toBe('signed-out')
    expect(uniworkCloudEnabled()).toBe(false)
    expect(uniworkCloudToolAvailable('web_search')).toBe(false)
    expect(cloudToolsEnabled({})).toBe(false)
    expect(() => uniworkCloudTransport()).toThrow(UniworkCloudError)
  })

  it('is enabled iff signed in + entitled, per tool', () => {
    const seen = vi.fn()
    const off = onUniworkCloudStatus(seen)
    setUniworkCloudStatus({ state: 'ready', enabled: true, tools, credits: null })
    expect(uniworkCloudEnabled()).toBe(true)
    expect(uniworkCloudToolAvailable('web_search')).toBe(true)
    expect(uniworkCloudToolAvailable('image_search')).toBe(false)
    expect(cloudToolsEnabled({})).toBe(true)
    expect(cloudToolsEnabled({ gskToolsEnabled: false })).toBe(false)
    setUniworkCloudStatus({ state: 'not-entitled', enabled: false, tools, credits: null })
    expect(uniworkCloudEnabled()).toBe(false)
    expect(uniworkCloudToolAvailable('web_search')).toBe(false)
    off()
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('normalizes IPC payloads: malformed reads as signed out, enabled never outlives the state', () => {
    expect(normalizeUniworkCloudStatus(null).state).toBe('signed-out')
    expect(normalizeUniworkCloudStatus({ state: 'bogus', enabled: true }).state).toBe('signed-out')
    expect(
      normalizeUniworkCloudStatus({ state: 'not-entitled', enabled: true, tools }).enabled,
    ).toBe(false)
    const inactive = normalizeUniworkCloudStatus({
      state: 'subscription-inactive',
      enabled: true,
      tools,
    })
    expect(inactive.state).toBe('subscription-inactive')
    expect(inactive.enabled).toBe(false)
    const n = normalizeUniworkCloudStatus({
      state: 'ready',
      enabled: true,
      tools: { web_search: 'yes', transcribe: true },
      credits: { used: 'x', limit: 10, remaining: 4, periodEnd: 7 },
      accessToken: 'never-copied',
    })
    expect(n.tools.web_search).toBe(false)
    expect(n.tools.transcribe).toBe(true)
    expect(n.credits).toEqual({
      unit: 'ai.tokens',
      used: 0,
      limit: 10,
      remaining: 4,
      periodEnd: null,
    })
    expect(JSON.stringify(n)).not.toContain('never-copied')
  })

  it('has guidance for the billing and membership errors, with no URL or token', () => {
    for (const code of ['subscription_inactive', 'no_access'] as const) {
      const message = new UniworkCloudError(code, 403).message
      expect(message).not.toMatch(/https?:|bearer/i)
      expect(message.length).toBeGreaterThan(20)
    }
  })

  it('error messages carry no URL or token, only guidance', () => {
    const e = new UniworkCloudError('credits_exhausted', 402)
    expect(e.message).toMatch(/out of credits/)
    expect(e.message).not.toMatch(/https?:|Bearer/)
  })
})

describe('re-reading the status', () => {
  const ready = { state: 'ready', enabled: true, tools, credits: null } as const

  it('does nothing where no refresher is installed (renderers, the CLI)', async () => {
    await expect(refreshUniworkCloudStatus(0)).resolves.toBeUndefined()
    await expect(refreshUniworkCloudStatusIfNotReady()).resolves.toBeUndefined()
  })

  it('picks up a plan switched back on before a tool is refused for the old state', async () => {
    setUniworkCloudStatus({ ...UNIWORK_CLOUD_SIGNED_OUT, state: 'not-entitled' })
    expect(uniworkCloudToolAvailable('image_generate')).toBe(false)
    setUniworkCloudRefresher(async () => setUniworkCloudStatus(ready))
    await refreshUniworkCloudStatusIfNotReady()
    expect(uniworkCloudToolAvailable('image_generate')).toBe(true)
  })

  it('does not re-read a ready status for a tool, but does for an AI panel opening', async () => {
    const read = vi.fn(async () => undefined)
    setUniworkCloudStatus(ready)
    setUniworkCloudRefresher(read)
    await refreshUniworkCloudStatusIfNotReady()
    expect(read).not.toHaveBeenCalled()
    await refreshUniworkCloudStatus()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('is rate-limited and single-flight, and a throwing or stalled read never throws or hangs', async () => {
    vi.useFakeTimers()
    const read = vi.fn(() => Promise.reject(new Error('offline')))
    setUniworkCloudRefresher(read)
    await Promise.all([refreshUniworkCloudStatus(), refreshUniworkCloudStatus()])
    expect(read).toHaveBeenCalledTimes(1)
    await refreshUniworkCloudStatus() // inside the minimum gap
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3_001)
    await refreshUniworkCloudStatus()
    expect(read).toHaveBeenCalledTimes(2)

    const stalled = vi.fn(() => new Promise<never>(() => undefined))
    setUniworkCloudRefresher(stalled)
    const waiting = refreshUniworkCloudStatus()
    vi.advanceTimersByTime(5_001)
    await expect(waiting).resolves.toBeUndefined()
  })
})
