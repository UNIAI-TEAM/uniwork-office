import { describe, expect, it } from 'vitest'
import { UNIWORK_CLOUD_SIGNED_OUT, type UniworkCloudStatus } from '@genoffice/ai-provider'
import {
  createUniworkAiAvailability,
  uniworkAiOffered,
} from '../src/main/uniwork-auth/ai-chat'
import {
  cloudChatEnabled,
  parseCloudStatus,
  statusFromServer,
} from '../src/main/uniwork-auth/cloud'
import { CapabilityCache, type CapabilityFetch } from '../src/main/uniwork-sync/capability/cache'

/**
 * G6-05 slice B: when the desktop offers UniWork AI (EXPERIENCE › S7, desktop):
 * the org's cloud status is `ready` with `tools.chat`, AND the org capability
 * `ai_uniwork` is on with the open format in `ai_uniwork_formats`, read through
 * the per-org CapabilityCache and its TTL rule. Anything else hides the entry
 * (no error).
 */

const ORG = 'org_a'

const readyCloud = (chat = true): UniworkCloudStatus =>
  ({
    state: 'ready',
    enabled: true,
    tools: {
      web_search: true,
      image_search: false,
      image_generate: false,
      media_analyze: false,
      transcribe: false,
      chat,
    },
    credits: null,
  }) as UniworkCloudStatus

const caps = (over: Record<string, unknown> = {}) => ({
  sync_feed: true,
  sync_write: true,
  offline_library: false,
  ai_uniwork: true,
  ai_uniwork_formats: ['docx', 'xlsx'],
  ttl_seconds: 300,
  ...over,
})

function harness(body: Record<string, unknown> = caps(), cloud = readyCloud()) {
  let now = 1_000_000
  let answer: { status: number; body: unknown } | 'offline' = { status: 200, body }
  let reads = 0
  const fetch: CapabilityFetch = async () => {
    reads++
    if (answer === 'offline') throw new Error('offline')
    return answer
  }
  const cache = new CapabilityCache({ fetch, clock: { now: () => now } })
  let cloudStatus = cloud
  const availability = createUniworkAiAvailability({
    cloud: () => cloudStatus,
    capability: (orgId) => cache.get(orgId),
  })
  return {
    availability,
    advance: (ms: number) => {
      now += ms
    },
    answer: (next: typeof answer) => {
      answer = next
    },
    setCloud: (next: UniworkCloudStatus) => {
      cloudStatus = next
    },
    reads: () => reads,
  }
}

describe('UniWork AI availability (desktop)', () => {
  it('offered when the cloud is ready with chat and the format is on', async () => {
    const h = harness()
    expect(await h.availability.available(ORG, 'docx')).toBe(true)
    expect(await h.availability.available(ORG, 'xlsx')).toBe(true)
  })

  it('hidden when format not in ai_uniwork_formats', async () => {
    const h = harness()
    expect(await h.availability.available(ORG, 'pptx')).toBe(false)
    expect(await h.availability.available(ORG, 'markdown')).toBe(false)
  })

  it('hidden when ai_uniwork off', async () => {
    // the kill switch empties the list on the server; a stale list still loses to the flag
    const h = harness(caps({ ai_uniwork: false }))
    expect(await h.availability.available(ORG, 'docx')).toBe(false)
  })

  it('hidden when tools.chat false', async () => {
    const h = harness(caps(), readyCloud(false))
    expect(await h.availability.available(ORG, 'docx')).toBe(false)
    h.setCloud(readyCloud(true))
    expect(await h.availability.available(ORG, 'docx')).toBe(true)
  })

  it('hidden when the cloud is not ready (signed out, not entitled, credits used up)', async () => {
    const h = harness()
    h.setCloud(UNIWORK_CLOUD_SIGNED_OUT)
    expect(await h.availability.available(ORG, 'docx')).toBe(false)
    h.setCloud({ ...readyCloud(), state: 'credits-exhausted' })
    expect(await h.availability.available(ORG, 'docx')).toBe(false)
    h.setCloud({ ...readyCloud(), state: 'not-entitled', enabled: false })
    expect(await h.availability.available(ORG, 'docx')).toBe(false)
  })

  it('hidden after TTL when the re-read fails; cached inside the TTL', async () => {
    const h = harness()
    expect(await h.availability.available(ORG, 'docx')).toBe(true)
    expect(h.reads()).toBe(1)
    h.answer('offline')
    // inside the TTL: served from the cache, no request
    h.advance(299_000)
    expect(await h.availability.available(ORG, 'docx')).toBe(true)
    expect(h.reads()).toBe(1)
    // past the TTL and the server cannot be read: AI turns off, the G5 flags stay
    h.advance(2_000)
    expect(await h.availability.available(ORG, 'docx')).toBe(false)
    // the server answers again: back on
    h.answer({ status: 200, body: caps() })
    expect(await h.availability.available(ORG, 'docx')).toBe(true)
  })

  it('hidden when the capability was never read (offline from the start)', async () => {
    const h = harness()
    h.answer('offline')
    expect(await h.availability.available(ORG, 'docx')).toBe(false)
  })

  it('a capability 401 hides it too (the session is re-evaluated elsewhere)', async () => {
    const h = harness()
    h.answer({ status: 401, body: undefined })
    expect(await h.availability.available(ORG, 'docx')).toBe(false)
  })

  it('no organization: hidden without a capability read', async () => {
    const h = harness()
    expect(await h.availability.available(null, 'docx')).toBe(false)
    expect(h.reads()).toBe(0)
  })

  it('the rule itself is pure', () => {
    const on = caps()
    expect(uniworkAiOffered(readyCloud(), on as never, 'docx')).toBe(true)
    expect(uniworkAiOffered(readyCloud(), null, 'docx')).toBe(false)
  })
})

describe('cloud status reads tools.chat', () => {
  it('parses chat from GET /ai/cloud', () => {
    const parsed = parseCloudStatus({
      enabled: true,
      tools: { web_search: false, chat: true },
      credits: null,
    })
    expect(cloudChatEnabled(parsed)).toBe(true)
    expect(
      cloudChatEnabled(parseCloudStatus({ enabled: true, tools: { web_search: true } })),
    ).toBe(false)
    expect(cloudChatEnabled(parseCloudStatus({ enabled: true, tools: { chat: 'yes' } }))).toBe(
      false,
    )
  })

  it('chat alone makes the cloud ready (UniWork AI usable), and is published', () => {
    const server = parseCloudStatus({ enabled: true, tools: { chat: true }, credits: null })
    const status = statusFromServer(server, { signedIn: true, orgId: ORG })
    expect(status.state).toBe('ready')
    expect(cloudChatEnabled(status)).toBe(true)
  })

  it('no tool and no chat stays unavailable', () => {
    const server = parseCloudStatus({ enabled: true, tools: {}, credits: null })
    expect(statusFromServer(server, { signedIn: true, orgId: ORG }).state).toBe('unavailable')
  })
})
