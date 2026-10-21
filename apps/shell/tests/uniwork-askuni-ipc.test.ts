import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { ACTIVE_WORKSPACE_KEY } from '../src/renderer/src/active-workspace'
import {
  ACTIVE_WORKSPACE_STORE_KEY,
  createAskUniService,
  registerAskUniIpc,
  type AskUniServiceDeps,
} from '../src/main/uniwork-askuni/service'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import {
  ASKUNI_CHANNELS,
  type AskUniRequest,
  type AskUniResult,
  type AskUniWorkspace,
} from '../src/shared/askuni-api'

/**
 * UNI-2069 s1: the Ask UNI service behind `uniwork:askuni:*` - input validation
 * (a refused input sends no request), the context (workspaces + the Home's
 * current workspace) and the IPC registration.
 */

const WS_A = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const WS_B = '01J8X4K2M0N1P2Q3R4S5T6U7V9'
const CONV = '01K4AICONV000000000000001'
const WORKSPACES: AskUniWorkspace[] = [
  { id: WS_A, name: 'Team' },
  { id: WS_B, name: 'Sales' },
]
const OK: AskUniResult = {
  ok: true,
  conversationId: CONV,
  message: { id: 'm1', content: 'hi', citations: [] },
}

function setup(over: Partial<AskUniServiceDeps> = {}) {
  const ask = vi.fn(async (_req: AskUniRequest): Promise<AskUniResult> => OK)
  const listWorkspaces = vi.fn(async () => WORKSPACES)
  const deps: AskUniServiceDeps = {
    isSignedIn: () => true,
    scopeKey: () => 'acc_1:org_a',
    listWorkspaces,
    activeWorkspaceId: () => null,
    client: { ask },
    now: () => 1_000,
    ...over,
  }
  return { service: createAskUniService(deps), ask, listWorkspaces }
}

const valid = (over: Record<string, unknown> = {}) => ({
  workspaceId: WS_A,
  question: 'task nào quá hạn?',
  locale: 'vi',
  ...over,
})

describe('context', () => {
  it('returns the signed-in account workspaces and the Home current one while it is listed', async () => {
    const { service } = setup({ activeWorkspaceId: () => WS_B })
    expect(await service.context()).toEqual({
      workspaces: WORKSPACES,
      currentWorkspaceId: WS_B,
      signedIn: true,
    })
  })

  it('falls back to the first workspace when nothing is stored or the stored one is gone', async () => {
    expect((await setup().service.context()).currentWorkspaceId).toBe(WS_A)
    const gone = setup({ activeWorkspaceId: () => 'ws_removed' })
    expect((await gone.service.context()).currentWorkspaceId).toBe(WS_A)
  })

  it('has no current workspace when the org lists none', async () => {
    const { service } = setup({ listWorkspaces: async () => [] })
    expect(await service.context()).toEqual({
      workspaces: [],
      currentWorkspaceId: null,
      signedIn: true,
    })
  })

  it('signed out: nothing listed, no server call', async () => {
    const { service, listWorkspaces } = setup({ isSignedIn: () => false })
    expect(await service.context()).toEqual({
      workspaces: [],
      currentWorkspaceId: null,
      signedIn: false,
    })
    expect(listWorkspaces).not.toHaveBeenCalled()
  })

  it('a failed list is an empty context that is still signed in', async () => {
    const { service } = setup({
      listWorkspaces: async () => {
        throw new UniworkDocError('network')
      },
    })
    expect(await service.context()).toEqual({
      workspaces: [],
      currentWorkspaceId: null,
      signedIn: true,
    })
  })

  it('RB-3: a failed list answers the cached list of the same scope (stale-if-error)', async () => {
    let now = 1_000
    let fail = false
    const { service } = setup({
      now: () => now,
      listWorkspaces: async () => {
        if (fail) throw new UniworkDocError('network')
        return WORKSPACES
      },
    })
    await service.context()
    fail = true
    now += 600_000
    expect(await service.context()).toEqual({
      workspaces: WORKSPACES,
      currentWorkspaceId: WS_A,
      signedIn: true,
    })
  })

  it('RB-3: a failed list does not answer the cache of another scope', async () => {
    let scope = 'acc_1:org_a'
    let fail = false
    const { service } = setup({
      scopeKey: () => scope,
      listWorkspaces: async () => {
        if (fail) throw new UniworkDocError('network')
        return WORKSPACES
      },
    })
    await service.context()
    fail = true
    scope = 'acc_2:org_b'
    expect(await service.context()).toEqual({
      workspaces: [],
      currentWorkspaceId: null,
      signedIn: true,
    })
  })

  it('RB-3: context is served from the 60 s cache while fresh, refetched once stale', async () => {
    let now = 1_000
    const { service, listWorkspaces } = setup({ now: () => now })
    await service.context()
    await service.context()
    expect(listWorkspaces).toHaveBeenCalledTimes(1)
    now += 61_000
    await service.context()
    expect(listWorkspaces).toHaveBeenCalledTimes(2)
  })

  it('reads the current workspace from the key the Home doclist stores it under', () => {
    expect(ACTIVE_WORKSPACE_STORE_KEY).toBe(ACTIVE_WORKSPACE_KEY)
  })
})

describe('ask validation', () => {
  const REFUSED: Array<[string, unknown]> = [
    ['not an object', 'hello'],
    ['null', null],
    ['an array', []],
    ['no question', valid({ question: undefined })],
    ['a non-string question', valid({ question: 42 })],
    ['an empty question', valid({ question: '' })],
    ['a blank question', valid({ question: '   \n\t ' })],
    ['a question over 2000 characters', valid({ question: 'x'.repeat(2001) })],
    ['an unknown locale', valid({ locale: 'fr' })],
    ['a missing locale', valid({ locale: undefined })],
    ['a missing workspace', valid({ workspaceId: undefined })],
    ['a non-string workspace', valid({ workspaceId: 7 })],
    ['a workspace with a path in it', valid({ workspaceId: '../x' })],
    ['a workspace the account is not in', valid({ workspaceId: 'ws_other' })],
    ['a non-string conversation', valid({ conversationId: 5 })],
    ['a conversation with a path in it', valid({ conversationId: '../../x' })],
    ['an over-long conversation', valid({ conversationId: 'c'.repeat(200) })],
  ]

  it.each(REFUSED)('refuses %s with error and sends no request', async (_name, input) => {
    const { service, ask } = setup()
    expect(await service.ask(input)).toEqual({ ok: false, code: 'error' })
    expect(ask).not.toHaveBeenCalled()
  })

  it('passes a trimmed question, the locale and the conversation to the client', async () => {
    const { service, ask } = setup()
    expect(await service.ask(valid({ question: '  hỏi gì đó \n', conversationId: CONV }))).toBe(OK)
    expect(ask).toHaveBeenCalledWith({
      workspaceId: WS_A,
      conversationId: CONV,
      question: 'hỏi gì đó',
      locale: 'vi',
    })
  })

  it('accepts a question of exactly 2000 characters and a new conversation', async () => {
    const { service, ask } = setup()
    await service.ask(valid({ question: 'x'.repeat(2000), locale: 'en' }))
    expect(ask).toHaveBeenCalledWith({
      workspaceId: WS_A,
      question: 'x'.repeat(2000),
      locale: 'en',
    })
  })

  it('never forwards fields the contract does not name', async () => {
    const { service, ask } = setup()
    await service.ask(valid({ model: 'opus', effort: 'high', focus: { kind: 'task', id: 'x' } }))
    expect(Object.keys(ask.mock.calls[0][0]).sort()).toEqual(['locale', 'question', 'workspaceId'])
  })

  it('signed out: signed_out and no request', async () => {
    const { service, ask, listWorkspaces } = setup({ isSignedIn: () => false })
    expect(await service.ask(valid())).toEqual({ ok: false, code: 'signed_out' })
    expect(ask).not.toHaveBeenCalled()
    expect(listWorkspaces).not.toHaveBeenCalled()
  })

  it('maps a failed workspace read to the same codes as the client', async () => {
    const failing = (error: unknown) =>
      setup({
        listWorkspaces: async () => {
          throw error
        },
      })
    expect(await failing(new UniworkDocError('network')).service.ask(valid())).toEqual({
      ok: false,
      code: 'offline',
    })
    expect(await failing(new UniworkDocError('session_expired')).service.ask(valid())).toEqual({
      ok: false,
      code: 'session',
    })
    expect(await failing(new UniworkDocError('not_signed_in')).service.ask(valid())).toEqual({
      ok: false,
      code: 'signed_out',
    })
    const other = failing(new Error('boom'))
    expect(await other.service.ask(valid())).toEqual({ ok: false, code: 'error' })
    expect(other.ask).not.toHaveBeenCalled()
  })

  it('reads the workspace list once for a burst of questions, again after it went stale or the account changed', async () => {
    let now = 1_000
    let scope = 'acc_1:org_a'
    const { service, listWorkspaces } = setup({ now: () => now, scopeKey: () => scope })
    await service.ask(valid())
    await service.ask(valid())
    expect(listWorkspaces).toHaveBeenCalledTimes(1)
    now += 61_000
    await service.ask(valid())
    expect(listWorkspaces).toHaveBeenCalledTimes(2)
    scope = 'acc_2:org_b'
    await service.ask(valid())
    expect(listWorkspaces).toHaveBeenCalledTimes(3)
  })

  it('a workspace that left the account is refused after the cache went stale', async () => {
    let now = 1_000
    let list = WORKSPACES
    const { service, ask } = setup({ now: () => now, listWorkspaces: async () => list })
    await service.ask(valid({ workspaceId: WS_B }))
    list = [WORKSPACES[0]]
    now += 61_000
    expect(await service.ask(valid({ workspaceId: WS_B }))).toEqual({ ok: false, code: 'error' })
    expect(ask).toHaveBeenCalledTimes(1)
  })
})

describe('RB-4: the workspace cache follows the scope and the sign-in', () => {
  it('does not cache a list read while the account or org changed under it', async () => {
    let scope = 'acc_1:org_a'
    let first = true
    const listWorkspaces = vi.fn(async () => {
      if (first) scope = 'acc_2:org_b'
      first = false
      return WORKSPACES
    })
    const { service } = setup({ scopeKey: () => scope, listWorkspaces })
    await service.ask(valid())
    // the account switched back within the TTL: B's list must not answer for A
    scope = 'acc_1:org_a'
    await service.ask(valid())
    expect(listWorkspaces).toHaveBeenCalledTimes(2)
  })

  it('forgets the list on sign-out: a sign-in within 60 s reads it again', async () => {
    let signedIn = true
    const { service, listWorkspaces } = setup({ isSignedIn: () => signedIn })
    await service.ask(valid())
    expect(listWorkspaces).toHaveBeenCalledTimes(1)
    signedIn = false
    await service.ask(valid())
    await service.context()
    signedIn = true
    await service.ask(valid())
    expect(listWorkspaces).toHaveBeenCalledTimes(2)
  })
})

describe('ipc registration', () => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      void handlers.set(channel, fn),
  } as unknown as IpcMain

  beforeEach(() => handlers.clear())

  it('answers uniwork:askuni:ask and uniwork:askuni:context from the service', async () => {
    const { service, ask } = setup()
    registerAskUniIpc(ipcMain, service)
    expect([...handlers.keys()].sort()).toEqual(
      [ASKUNI_CHANNELS.ask, ASKUNI_CHANNELS.context].sort(),
    )
    expect(ASKUNI_CHANNELS).toEqual({
      ask: 'uniwork:askuni:ask',
      context: 'uniwork:askuni:context',
      openCitation: 'uniwork:askuni:open-citation',
    })
    expect(await handlers.get(ASKUNI_CHANNELS.ask)!({}, valid())).toBe(OK)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(await handlers.get(ASKUNI_CHANNELS.context)!({})).toMatchObject({
      workspaces: WORKSPACES,
      signedIn: true,
    })
  })

  it('refuses a malformed payload through the channel without a request', async () => {
    const { service, ask } = setup()
    registerAskUniIpc(ipcMain, service)
    expect(await handlers.get(ASKUNI_CHANNELS.ask)!({}, { question: '' })).toEqual({
      ok: false,
      code: 'error',
    })
    expect(await handlers.get(ASKUNI_CHANNELS.ask)!({})).toEqual({ ok: false, code: 'error' })
    expect(ask).not.toHaveBeenCalled()
  })

  it('an unexpected throw inside the service still answers as an error result', async () => {
    const { service } = setup({
      client: {
        ask: async () => {
          throw new Error('boom')
        },
      },
    })
    registerAskUniIpc(ipcMain, service)
    expect(await handlers.get(ASKUNI_CHANNELS.ask)!({}, valid())).toEqual({
      ok: false,
      code: 'error',
    })
  })
})
