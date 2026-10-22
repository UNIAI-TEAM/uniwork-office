import { describe, expect, it, vi } from 'vitest'
import type { AskUniLookupClient } from '../src/main/uniwork-askuni/lookup-client'
import type { AskUniRestClient } from '../src/main/uniwork-askuni/rest-client'
import {
  createAskUniRestService,
  type AskUniRestServiceDeps,
} from '../src/main/uniwork-askuni/rest-service'

/**
 * UNI-2076 s2: the Ask UNI v2 REST service: every input is validated (ids,
 * workspace check like P1, title / note bounds, enum values) and a refused
 * input sends no request.
 */

const WS = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const CONV = '01K4AICONV000000000000001'
const MSG = '01K4AIMSG0000000000000001'
const OK = { ok: true as const }

function setup(over: Partial<AskUniRestServiceDeps> = {}) {
  const rest: { [K in keyof AskUniRestClient]: ReturnType<typeof vi.fn> } = {
    capabilities: vi.fn(async () => ({ ok: true, enabled: true, models: [], autoModel: '' })),
    conversations: vi.fn(async () => ({ ok: true, conversations: [] })),
    messages: vi.fn(async () => ({ ok: true, messages: [] })),
    rename: vi.fn(async () => OK),
    remove: vi.fn(async () => OK),
    feedbackSet: vi.fn(async () => OK),
    feedbackClear: vi.fn(async () => OK),
  }
  const lookup = { lookup: vi.fn(async () => ({ ok: true, items: [] })) }
  const checkWorkspace = vi.fn(async (id: string) => (id === WS ? null : ('error' as const)))
  const deps: AskUniRestServiceDeps = {
    isSignedIn: () => true,
    checkWorkspace,
    rest: rest as unknown as AskUniRestClient,
    lookup: lookup as unknown as AskUniLookupClient,
    ...over,
  }
  const sent = () =>
    Object.values(rest).reduce((n, fn) => n + fn.mock.calls.length, 0) +
    lookup.lookup.mock.calls.length
  return { service: createAskUniRestService(deps), rest, lookup, checkWorkspace, sent }
}

const ERROR = { ok: false, error: 'error' }

describe('workspace routes', () => {
  it('capabilities and conversations check the workspace first', async () => {
    const { service, rest, checkWorkspace } = setup()
    expect(await service.capabilities({ workspaceId: WS })).toMatchObject({ ok: true })
    expect(await service.conversations({ workspaceId: WS })).toMatchObject({ ok: true })
    expect(rest.capabilities).toHaveBeenCalledWith(WS)
    expect(rest.conversations).toHaveBeenCalledWith(WS)
    expect(checkWorkspace).toHaveBeenCalledTimes(2)
  })

  it('an unknown workspace, a bad id or a failed list sends nothing', async () => {
    const { service, sent } = setup()
    expect(await service.capabilities({ workspaceId: 'ws_other' })).toEqual(ERROR)
    expect(await service.conversations({ workspaceId: '../x' })).toEqual(ERROR)
    expect(await service.conversations(null)).toEqual(ERROR)
    expect(sent()).toBe(0)
    const offline = setup({ checkWorkspace: async () => 'offline' })
    expect(await offline.service.conversations({ workspaceId: WS })).toEqual({
      ok: false,
      error: 'offline',
    })
  })

  it('signed out is signed_out with no request', async () => {
    const { service, sent } = setup({ isSignedIn: () => false })
    expect(await service.messages({ conversationId: CONV })).toEqual({
      ok: false,
      error: 'signed_out',
    })
    expect(await service.rename({ conversationId: CONV, title: 'x' })).toEqual({
      ok: false,
      error: 'signed_out',
    })
    expect(sent()).toBe(0)
  })
})

describe('conversation routes', () => {
  it('messages / delete take a valid conversation id', async () => {
    const { service, rest, sent } = setup()
    await service.messages({ conversationId: CONV })
    await service.remove({ conversationId: CONV })
    expect(rest.messages).toHaveBeenCalledWith(CONV)
    expect(rest.remove).toHaveBeenCalledWith(CONV)
    expect(await service.messages({ conversationId: 'a/b' })).toEqual(ERROR)
    expect(await service.remove({})).toEqual(ERROR)
    expect(sent()).toBe(2)
  })

  it('rename trims the title and keeps it 1-80 characters', async () => {
    const { service, rest } = setup()
    expect(await service.rename({ conversationId: CONV, title: '  Việc tuần này  ' })).toEqual(OK)
    expect(rest.rename).toHaveBeenCalledWith(CONV, 'Việc tuần này')
    expect(await service.rename({ conversationId: CONV, title: '   ' })).toEqual(ERROR)
    expect(await service.rename({ conversationId: CONV, title: 'x'.repeat(81) })).toEqual(ERROR)
    expect(await service.rename({ conversationId: CONV, title: 5 })).toEqual(ERROR)
    expect(rest.rename).toHaveBeenCalledTimes(1)
  })

  it('feedback: rating and reason from their sets, note at most 500, contract fields only', async () => {
    const { service, rest } = setup()
    expect(
      await service.feedbackSet({
        conversationId: CONV,
        messageId: MSG,
        rating: 'down',
        reason: 'missing_sources',
        note: 'thiếu nguồn',
        extra: 'x',
      }),
    ).toEqual(OK)
    expect(rest.feedbackSet).toHaveBeenCalledWith({
      conversationId: CONV,
      messageId: MSG,
      rating: 'down',
      reason: 'missing_sources',
      note: 'thiếu nguồn',
    })
    const base = { conversationId: CONV, messageId: MSG, rating: 'up' }
    expect(await service.feedbackSet({ ...base, rating: 'meh' })).toEqual(ERROR)
    expect(await service.feedbackSet({ ...base, reason: 'rude' })).toEqual(ERROR)
    expect(await service.feedbackSet({ ...base, note: 'x'.repeat(501) })).toEqual(ERROR)
    expect(await service.feedbackSet({ ...base, messageId: '' })).toEqual(ERROR)
    expect(rest.feedbackSet).toHaveBeenCalledTimes(1)
  })

  it('feedback clear takes both ids', async () => {
    const { service, rest } = setup()
    expect(await service.feedbackClear({ conversationId: CONV, messageId: MSG })).toEqual(OK)
    expect(rest.feedbackClear).toHaveBeenCalledWith(CONV, MSG)
    expect(await service.feedbackClear({ conversationId: CONV })).toEqual(ERROR)
    expect(rest.feedbackClear).toHaveBeenCalledTimes(1)
  })

  it('a client that throws still answers an error result', async () => {
    const { service, rest } = setup()
    rest.messages.mockRejectedValueOnce(new Error('boom'))
    expect(await service.messages({ conversationId: CONV })).toEqual(ERROR)
  })
})

describe('lookup', () => {
  it('passes a known kind and a trimmed, bounded query after the workspace check', async () => {
    const { service, lookup } = setup()
    await service.lookup({ workspaceId: WS, kind: 'member', query: `  ${'a'.repeat(300)} ` })
    expect(lookup.lookup).toHaveBeenCalledWith({
      workspaceId: WS,
      kind: 'member',
      query: 'a'.repeat(200),
    })
  })

  it('refuses an unknown kind, a non-string query or an unknown workspace', async () => {
    const { service, sent } = setup()
    expect(await service.lookup({ workspaceId: WS, kind: 'email', query: '' })).toEqual(ERROR)
    expect(await service.lookup({ workspaceId: WS, kind: 'task', query: 5 })).toEqual(ERROR)
    expect(await service.lookup({ workspaceId: 'ws_x', kind: 'task', query: 'a' })).toEqual(ERROR)
    expect(sent()).toBe(0)
  })
})
