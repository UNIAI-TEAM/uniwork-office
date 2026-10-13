import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkLaunchEvent } from '../src/shared/home-api'
import type { ProfileOutcome } from '../src/main/uniwork-auth/profile-store'
import { createAuthCallbackRouter } from '../src/main/uniwork-auth/routing'
import { isAuthCallbackUrl } from '../src/main/uniwork-auth/callback'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import {
  LAUNCH_TICKET_TTL_MS,
  LaunchController,
  createLaunchPusher,
  createPushHolder,
  parseOfficeDeepLink,
} from '../src/main/uniwork-docs/launch'
import { LAUNCH_REPLAY_MS, createLaunchReplay } from '../src/preload/launch-replay'
import { parseExchange, type LaunchDescriptor } from '../src/main/uniwork-docs/parse'

// verbatim from dev-uniwork docs/office/g3g4/vectors/deep-link.json
const DEEP_LINK = {
  canonical: 'uniwork-office://open?ticket=ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde',
  valid: [
    {
      id: 'canonical-open',
      url: 'uniwork-office://open?ticket=ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde',
      expected: { ticket: 'ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde' },
    },
  ],
  invalid: [
    {
      id: 'wrong-scheme',
      url: 'https://open?ticket=ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde',
      expected_reason: 'wrong_scheme',
    },
    {
      id: 'wrong-host',
      url: 'uniwork-office://other?ticket=ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde',
      expected_reason: 'wrong_host',
    },
    {
      id: 'nested-path',
      url: 'uniwork-office://open/nested?ticket=ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde',
      expected_reason: 'wrong_path',
    },
    {
      id: 'duplicate-ticket',
      url: 'uniwork-office://open?ticket=ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde&ticket=ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde',
      expected_reason: 'duplicate_ticket',
    },
    {
      id: 'server-url',
      url: 'uniwork-office://open?ticket=ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde&server_url=https%3A%2F%2Fevil.test',
      expected_reason: 'unexpected_parameter',
    },
    {
      id: 'path-metadata',
      url: 'uniwork-office://open?ticket=ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde&path=%2Ftmp%2Fsecret',
      expected_reason: 'unexpected_parameter',
    },
    {
      id: 'login-code',
      url: 'uniwork-office://open?ticket=code_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde',
      expected_reason: 'login_code',
    },
  ],
}

// verbatim from docs/office/g3g4/vectors/launch-ticket.json
const LAUNCH_TICKET = {
  valid: [{ id: 'valid-ticket', ticket: 'ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde' }],
  invalid: [
    {
      id: 'login-code-prefix',
      ticket: 'code_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde',
      expected_reason: 'login_code',
    },
    { id: 'too-short', ticket: 'ticket_short', expected_reason: 'invalid_ticket' },
    {
      id: 'login-state-prefix',
      ticket: 'state_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde',
      expected_reason: 'login_code',
    },
    { id: 'oversized', ticket_length: 193, expected_reason: 'oversized_ticket' },
  ],
}

// verbatim from docs/office/g3g4/vectors/exchange.json (responses only)
const EXCHANGE = {
  request: {
    launch_ticket: 'ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde',
    deployment_id: 'production-eu',
    client_id: 'uniwork-office',
    device_session_id: 'device-01',
  },
  valid_response: {
    receipt_id: '01J8X4RECEIPT1P2Q3R4S5T6U7',
    document: {
      id: '01J8X4DOC0N1P2Q3R4S5T6U7',
      organization_id: '01J8X4ORGN1P2Q3R4S5T6U7V8',
      workspace_id: '01J8X4WS0N1P2Q3R4S5T6U7V8',
      title: 'Q4 plan',
      kind: 'file',
      operation: 'edit',
      version: 0,
      revision: '41',
      contract_version: 'uniwork-office-engine-contract/1',
      protocol_version: '1',
      download_path: '/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/download',
    },
    redeemed_at: '2026-09-30T10:01:02Z',
  },
  invalid: [
    {
      id: 'foreign-server-url',
      response: {
        receipt_id: 'r',
        document: {
          id: 'd',
          organization_id: 'o',
          workspace_id: 'w',
          title: 'Q4 plan',
          kind: 'file',
          operation: 'view',
          version: 0,
          revision: '1',
          contract_version: 'uniwork-office-engine-contract/1',
          protocol_version: '1',
          download_path: 'https://storage.example/signed',
        },
        redeemed_at: '2026-09-30T10:01:02Z',
      },
      expected_reason: 'malformed_response',
    },
    {
      id: 'missing-receipt',
      response: { document: { id: 'd' }, redeemed_at: '2026-09-30T10:01:02Z' },
      expected_reason: 'malformed_response',
    },
  ],
}

const SCHEME = 'uniwork-office'
const TICKET = LAUNCH_TICKET.valid[0]!.ticket
const link = (ticket: string, scheme = SCHEME) => `${scheme}://open?ticket=${ticket}`

describe('deep-link parser (shared vectors)', () => {
  it.each(DEEP_LINK.valid)('$id', ({ url, expected }) => {
    expect(parseOfficeDeepLink(url, SCHEME)).toEqual({
      ok: true,
      ticket: expected.ticket,
      profile: null,
    })
  })
  it.each(DEEP_LINK.invalid)('$id', ({ url, expected_reason }) => {
    expect(parseOfficeDeepLink(url, SCHEME)).toEqual({ ok: false, reason: expected_reason })
  })
  it.each(LAUNCH_TICKET.invalid)('ticket $id', (vector) => {
    const ticket =
      'ticket' in vector ? vector.ticket : `ticket_${'a'.repeat(vector.ticket_length - 7)}`
    expect(parseOfficeDeepLink(link(ticket), SCHEME)).toEqual({
      ok: false,
      reason: vector.expected_reason,
    })
  })
  it('accepts only the active channel scheme, a single slash path, and no fragment/port/userinfo', () => {
    expect(parseOfficeDeepLink(link(TICKET, 'uniwork-office-dev'), SCHEME)).toEqual({
      ok: false,
      reason: 'wrong_scheme',
    })
    expect(parseOfficeDeepLink(link(TICKET, 'uniwork-office-dev'), 'uniwork-office-dev')).toEqual({
      ok: true,
      ticket: TICKET,
      profile: null,
    })
    expect(parseOfficeDeepLink(`${SCHEME}://open/?ticket=${TICKET}`, SCHEME).ok).toBe(true)
    expect(parseOfficeDeepLink(`${link(TICKET)}#x`, SCHEME)).toEqual({
      ok: false,
      reason: 'fragment_not_allowed',
    })
    expect(parseOfficeDeepLink(`${SCHEME}://open:8080?ticket=${TICKET}`, SCHEME)).toEqual({
      ok: false,
      reason: 'wrong_host',
    })
    expect(parseOfficeDeepLink(`${SCHEME}://u:p@open?ticket=${TICKET}`, SCHEME)).toEqual({
      ok: false,
      reason: 'wrong_host',
    })
    // neither a ticket nor a profile: bring the window forward, change nothing
    expect(parseOfficeDeepLink(`${SCHEME}://open`, SCHEME)).toEqual({
      ok: true,
      ticket: null,
      profile: null,
    })
    expect(parseOfficeDeepLink(`${SCHEME}://`, SCHEME)).toEqual({
      ok: true,
      ticket: null,
      profile: null,
    })
  })
})

const PROFILE_QUERY =
  'deploymentId=production-eu&apiOrigin=https%3A%2F%2Funiwork.example&clientId=uniwork-office&channel=stable'
const PROFILE = {
  deploymentId: 'production-eu',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  channel: 'stable',
}

describe('deep-link parser: the server profile', () => {
  it('reads a ticket with the four profile parameters', () => {
    expect(parseOfficeDeepLink(`${link(TICKET)}&${PROFILE_QUERY}`, SCHEME)).toEqual({
      ok: true,
      ticket: TICKET,
      profile: PROFILE,
    })
  })
  it('reads the app-home form: profile without a ticket', () => {
    expect(parseOfficeDeepLink(`${SCHEME}://open?${PROFILE_QUERY}`, SCHEME)).toEqual({
      ok: true,
      ticket: null,
      profile: PROFILE,
    })
  })
  it('reads the home route: the profile, never a ticket', () => {
    expect(parseOfficeDeepLink(`${SCHEME}://home?${PROFILE_QUERY}`, SCHEME)).toEqual({
      ok: true,
      ticket: null,
      profile: PROFILE,
    })
    expect(parseOfficeDeepLink(`${SCHEME}://home`, SCHEME)).toEqual({
      ok: true,
      ticket: null,
      profile: null,
    })
    expect(parseOfficeDeepLink(`${SCHEME}://home?ticket=${TICKET}`, SCHEME)).toEqual({
      ok: false,
      reason: 'unexpected_parameter',
    })
    expect(parseOfficeDeepLink(`${SCHEME}://home/x?${PROFILE_QUERY}`, SCHEME)).toEqual({
      ok: false,
      reason: 'wrong_path',
    })
  })
  it('keeps the old ticket-only link valid', () => {
    expect(parseOfficeDeepLink(link(TICKET), SCHEME)).toMatchObject({ ok: true, profile: null })
  })
  it('rejects a partial profile, a repeated parameter and any other parameter', () => {
    expect(
      parseOfficeDeepLink(`${link(TICKET)}&deploymentId=production-eu&channel=stable`, SCHEME),
    ).toEqual({ ok: false, reason: 'partial_profile' })
    expect(parseOfficeDeepLink(`${link(TICKET)}&${PROFILE_QUERY}&channel=stable`, SCHEME)).toEqual({
      ok: false,
      reason: 'duplicate_parameter',
    })
    expect(parseOfficeDeepLink(`${link(TICKET)}&${PROFILE_QUERY}&x=1`, SCHEME)).toEqual({
      ok: false,
      reason: 'unexpected_parameter',
    })
  })
  it('rejects values the profile rules refuse', () => {
    const bad = (query: string) => parseOfficeDeepLink(`${SCHEME}://open?${query}`, SCHEME)
    const withOrigin = (origin: string) =>
      PROFILE_QUERY.replace('https%3A%2F%2Funiwork.example', origin)
    const invalid = { ok: false, reason: 'invalid_profile' }
    // http outside dev loopback, a path, a client id that does not fit the channel
    expect(bad(withOrigin('http%3A%2F%2Funiwork.example'))).toEqual(invalid)
    expect(bad(withOrigin('https%3A%2F%2Funiwork.example%2Fapi'))).toEqual(invalid)
    expect(
      bad(PROFILE_QUERY.replace('clientId=uniwork-office', 'clientId=uniwork-office-dev')),
    ).toEqual(invalid)
    expect(bad(PROFILE_QUERY.replace('channel=stable', 'channel=nightly'))).toEqual(invalid)
  })
  it('allows http loopback only for a dev link on the dev scheme', () => {
    const dev =
      'deploymentId=default&apiOrigin=http%3A%2F%2Flocalhost%3A8080&clientId=uniwork-office-dev&channel=dev'
    expect(
      parseOfficeDeepLink(`uniwork-office-dev://open?${dev}`, 'uniwork-office-dev'),
    ).toMatchObject({
      ok: true,
      profile: { apiOrigin: 'http://localhost:8080', channel: 'dev' },
    })
    // a dev profile on the stable scheme is not addressed to this app
    expect(parseOfficeDeepLink(`${SCHEME}://open?${dev}`, SCHEME)).toEqual({
      ok: false,
      reason: 'invalid_profile',
    })
  })
})

describe('exchange receipt', () => {
  it('parses the valid vector', () => {
    expect(parseExchange(EXCHANGE.valid_response)).toMatchObject({
      receiptId: '01J8X4RECEIPT1P2Q3R4S5T6U7',
      id: '01J8X4DOC0N1P2Q3R4S5T6U7',
      workspaceId: '01J8X4WS0N1P2Q3R4S5T6U7V8',
      operation: 'edit',
      version: 0,
      revision: '41',
    })
  })
  it.each(EXCHANGE.invalid)('$id', ({ response, expected_reason }) => {
    expect(() => parseExchange(response)).toThrow(UniworkDocError)
    try {
      parseExchange(response)
    } catch (error) {
      expect((error as UniworkDocError).code).toBe(expected_reason)
    }
  })
  it('keeps a valid comment_id from the ticket and ignores a malformed one', () => {
    const CMT = '01J8X4CMTN0N1P2Q3R4S5T6U7'
    expect(parseExchange({ ...EXCHANGE.valid_response, comment_id: CMT }).commentId).toBe(CMT)
    // the server drops a bad comment silently; the client never invents one
    expect(parseExchange({ ...EXCHANGE.valid_response, comment_id: '' }).commentId).toBeUndefined()
    expect(parseExchange({ ...EXCHANGE.valid_response, comment_id: 7 }).commentId).toBeUndefined()
    expect(parseExchange(EXCHANGE.valid_response).commentId).toBeUndefined()
  })

  it('a historical version must carry ?version=N', () => {
    const doc = { ...EXCHANGE.valid_response.document, version: 2, operation: 'view' }
    expect(() => parseExchange({ ...EXCHANGE.valid_response, document: doc })).toThrow()
    const ok = { ...doc, download_path: `${doc.download_path}?version=2` }
    expect(parseExchange({ ...EXCHANGE.valid_response, document: ok }).version).toBe(2)
  })

  const statusCases: Array<[number, string]> = [
    [401, 'session_expired'],
    [403, 'forbidden'],
    [404, 'ticket_invalid'],
    [410, 'ticket_invalid'],
    [409, 'server_error'],
    [500, 'server_error'],
  ]
  it.each(statusCases)('HTTP %i -> %s, request in snake_case', async (status, code) => {
    const fetch = vi.fn<FetchLike>(
      async () => new Response(JSON.stringify({ error: { code: 'x', message: 'x' } }), { status }),
    )
    const api = createUniworkDocsClient({
      apiOrigin: 'https://uniwork.example',
      authorized: (call) => call('tok'),
      isSignedIn: () => true,
      fetch,
    })
    const failure = await api
      .exchange({
        launchTicket: EXCHANGE.request.launch_ticket,
        deploymentId: 'production-eu',
        clientId: 'uniwork-office',
        deviceSessionId: 'device-01',
      })
      .then(
        () => 'resolved',
        (error: UniworkDocError) => error.code,
      )
    expect(failure).toBe(code)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://uniwork.example/api/v1/office/sessions/exchange')
    expect(JSON.parse(String(init.body))).toEqual(EXCHANGE.request)
  })
})

describe('launch controller', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z') }))
  afterEach(() => vi.useRealTimers())

  const descriptor = parseExchange(EXCHANGE.valid_response)

  function setup(opts: { signedIn?: boolean; exchange?: () => Promise<LaunchDescriptor> } = {}) {
    let signedIn = opts.signedIn ?? true
    const events: UniworkLaunchEvent[] = []
    const exchange = vi.fn(opts.exchange ?? (async () => descriptor))
    const open = vi.fn(async (d: LaunchDescriptor) => ({
      path: `/wc/${d.id}/Q4 plan.docx`,
      title: d.title,
    }))
    const reveal = vi.fn()
    const controller = new LaunchController({
      scheme: () => SCHEME,
      applyProfile: async () => 'applied',
      isSignedIn: () => signedIn,
      identity: () =>
        signedIn ? { deviceSessionId: 'device-01', deploymentId: 'production-eu' } : null,
      profile: () => ({ deploymentId: 'production-eu', clientId: 'uniwork-office' }),
      exchange,
      open,
      emit: (e) => events.push(e),
      reveal,
    })
    return { controller, events, exchange, open, reveal, signIn: () => (signedIn = true) }
  }

  it('redeems once, opens with the descriptor, reveals the window', async () => {
    const ctx = setup()
    await Promise.all([
      ctx.controller.handleUrl(link(TICKET)),
      ctx.controller.handleUrl(link(TICKET)),
    ])
    await ctx.controller.handleUrl(link(TICKET))
    expect(ctx.exchange).toHaveBeenCalledTimes(1)
    expect(ctx.exchange.mock.calls[0]![0]).toEqual({
      launchTicket: TICKET,
      deploymentId: 'production-eu',
      clientId: 'uniwork-office',
      deviceSessionId: 'device-01',
    })
    expect(ctx.open).toHaveBeenCalledWith(descriptor)
    expect(ctx.reveal).toHaveBeenCalled()
    expect(ctx.events.at(-1)).toEqual({
      phase: 'opened',
      path: `/wc/${descriptor.id}/Q4 plan.docx`,
      title: 'Q4 plan',
    })
  })

  it('a ticket naming a comment reveals it after the editor is ready', async () => {
    const CMT = '01J8X4CMTN0N1P2Q3R4S5T6U7'
    const withComment = parseExchange({ ...EXCHANGE.valid_response, comment_id: CMT })
    const ctx = setup({ exchange: async () => withComment })
    const revealed = vi.fn()
    // the shell holds the reveal until the editor renderer is ready; here the
    // open already resolved, so the reveal fires once with the opened path
    const controller = new LaunchController({
      scheme: () => SCHEME,
      applyProfile: async () => 'applied',
      isSignedIn: () => true,
      identity: () => ({ deviceSessionId: 'device-01', deploymentId: 'production-eu' }),
      profile: () => ({ deploymentId: 'production-eu', clientId: 'uniwork-office' }),
      exchange: async () => withComment,
      open: async (d) => ({ path: `/wc/${d.id}/Q4 plan.docx`, title: d.title }),
      emit: () => undefined,
      reveal: () => undefined,
      revealComment: revealed,
    })
    void ctx
    await controller.handleUrl(link(TICKET))
    expect(revealed).toHaveBeenCalledWith(`/wc/${withComment.id}/Q4 plan.docx`, CMT)
  })

  it('a malformed link fails without any exchange', async () => {
    const ctx = setup()
    await ctx.controller.handleUrl(
      `${SCHEME}://open?ticket=code_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde`,
    )
    expect(ctx.exchange).not.toHaveBeenCalled()
    expect(ctx.events).toEqual([{ phase: 'failed', error: 'ticket_invalid' }])
  })

  it('signed out: holds the ticket in memory and redeems it after sign-in within the TTL', async () => {
    const ctx = setup({ signedIn: false })
    await ctx.controller.handleUrl(link(TICKET))
    expect(ctx.events).toEqual([{ phase: 'needs-sign-in' }])
    expect(ctx.exchange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(LAUNCH_TICKET_TTL_MS - 1000)
    ctx.signIn()
    await ctx.controller.onSignedIn()
    expect(ctx.exchange).toHaveBeenCalledTimes(1)
    expect(ctx.events.at(-1)?.phase).toBe('opened')
  })

  it('signed out past the TTL: the link expired, never exchanged', async () => {
    const ctx = setup({ signedIn: false })
    await ctx.controller.handleUrl(link(TICKET))
    vi.advanceTimersByTime(LAUNCH_TICKET_TTL_MS + 1)
    expect(ctx.events.at(-1)).toEqual({ phase: 'failed', error: 'ticket_expired' })
    ctx.signIn()
    await ctx.controller.onSignedIn()
    await ctx.controller.handleUrl(link(TICKET))
    expect(ctx.exchange).not.toHaveBeenCalled()
  })

  it('a lost exchange response is terminal: the ticket is never retried', async () => {
    const ctx = setup({ exchange: async () => Promise.reject(new UniworkDocError('network')) })
    await ctx.controller.handleUrl(link(TICKET))
    await ctx.controller.handleUrl(link(TICKET))
    expect(ctx.exchange).toHaveBeenCalledTimes(1)
    expect(ctx.events.at(-1)).toEqual({ phase: 'failed', error: 'network' })
  })

  it('an exchange refused as session_expired (auth before the ticket) holds the ticket and asks for sign-in', async () => {
    let calls = 0
    const ctx = setup({
      exchange: async () => {
        calls += 1
        if (calls === 1) throw new UniworkDocError('session_expired')
        return descriptor
      },
    })
    await ctx.controller.handleUrl(link(TICKET))
    expect(ctx.events.at(-1)).toEqual({ phase: 'needs-sign-in' })
    // the same link again while held: not a second exchange
    await ctx.controller.handleUrl(link(TICKET))
    expect(ctx.exchange).toHaveBeenCalledTimes(1)
    await ctx.controller.onSignedIn()
    expect(ctx.exchange).toHaveBeenCalledTimes(2)
    expect(ctx.events.at(-1)?.phase).toBe('opened')
  })

  it('a session of another deployment never exchanges', async () => {
    const events: UniworkLaunchEvent[] = []
    const exchange = vi.fn()
    const controller = new LaunchController({
      scheme: () => SCHEME,
      applyProfile: async () => 'applied',
      isSignedIn: () => true,
      identity: () => ({ deviceSessionId: 'd', deploymentId: 'other' }),
      profile: () => ({ deploymentId: 'production-eu', clientId: 'uniwork-office' }),
      exchange,
      open: vi.fn(),
      emit: (e) => events.push(e),
      reveal: vi.fn(),
    })
    await controller.handleUrl(link(TICKET))
    expect(exchange).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual({ phase: 'failed', error: 'wrong_deployment' })
  })
})

describe('launch controller: the server profile comes before the ticket', () => {
  const descriptor = parseExchange(EXCHANGE.valid_response)
  const withProfile = `${link(TICKET)}&${PROFILE_QUERY}`

  function setup(outcome: ProfileOutcome, signedIn = true) {
    const events: UniworkLaunchEvent[] = []
    const calls: string[] = []
    const applyProfile = vi.fn(async (_profile: unknown) => {
      calls.push('profile')
      return outcome
    })
    const exchange = vi.fn(async () => {
      calls.push('exchange')
      return descriptor
    })
    const controller = new LaunchController({
      scheme: () => SCHEME,
      applyProfile,
      isSignedIn: () => signedIn,
      identity: () => ({ deviceSessionId: 'device-01', deploymentId: 'production-eu' }),
      profile: () => ({ deploymentId: 'production-eu', clientId: 'uniwork-office' }),
      exchange,
      open: vi.fn(async () => ({ path: '/wc/a.docx', title: 'Q4 plan' })),
      emit: (e) => events.push(e),
      reveal: vi.fn(),
    })
    return { controller, events, applyProfile, exchange, calls }
  }

  it('applies the profile, then redeems the ticket', async () => {
    const ctx = setup('applied')
    await ctx.controller.handleUrl(withProfile)
    expect(ctx.applyProfile).toHaveBeenCalledWith(PROFILE)
    expect(ctx.calls).toEqual(['profile', 'exchange'])
  })
  it('a declined server drops the link: nothing redeemed or held', async () => {
    const ctx = setup('declined', false)
    await ctx.controller.handleUrl(withProfile)
    expect(ctx.exchange).not.toHaveBeenCalled()
    expect(ctx.events).toEqual([])
    await ctx.controller.onSignedIn()
    expect(ctx.exchange).not.toHaveBeenCalled()
  })
  it('a refused server (other channel) fails the ticket without redeeming it', async () => {
    const ctx = setup('refused')
    await ctx.controller.handleUrl(withProfile)
    expect(ctx.exchange).not.toHaveBeenCalled()
    expect(ctx.events).toEqual([{ phase: 'failed', error: 'ticket_invalid' }])
  })
  it('the home link (profile, no ticket) only applies the profile', async () => {
    const ctx = setup('applied')
    await ctx.controller.handleUrl(`${SCHEME}://open?${PROFILE_QUERY}`)
    expect(ctx.applyProfile).toHaveBeenCalledTimes(1)
    expect(ctx.exchange).not.toHaveBeenCalled()
    expect(ctx.events).toEqual([])
  })
  it('a ticket held for the old server is dropped when a link moves the server', async () => {
    const ctx = setup('applied', false)
    await ctx.controller.handleUrl(link(TICKET))
    expect(ctx.events).toEqual([{ phase: 'needs-sign-in' }])
    await ctx.controller.handleUrl(`${SCHEME}://home?${PROFILE_QUERY}`)
    await ctx.controller.onSignedIn()
    expect(ctx.exchange).not.toHaveBeenCalled()
    // and the same ticket delivered again is not held a second time
    await ctx.controller.handleUrl(link(TICKET))
    expect(ctx.events).toEqual([{ phase: 'needs-sign-in' }])
  })
  it('an unchanged server keeps the held ticket', async () => {
    const ctx = setup('unchanged', false)
    await ctx.controller.handleUrl(link(TICKET))
    await ctx.controller.handleUrl(`${SCHEME}://home?${PROFILE_QUERY}`)
    await ctx.controller.onSignedIn()
    expect(ctx.exchange).toHaveBeenCalledTimes(1)
  })
  it('a ticket-only link never touches the profile', async () => {
    const ctx = setup('applied')
    await ctx.controller.handleUrl(link(TICKET))
    expect(ctx.applyProfile).not.toHaveBeenCalled()
    expect(ctx.exchange).toHaveBeenCalledTimes(1)
  })
  it('a bare scheme only reveals the window', async () => {
    const ctx = setup('applied')
    await ctx.controller.handleUrl(`${SCHEME}://`)
    expect(ctx.applyProfile).not.toHaveBeenCalled()
    expect(ctx.events).toEqual([])
  })
  it('routes the bare scheme and the profile link to the launch route, not sign-in', () => {
    expect(isAuthCallbackUrl(`${SCHEME}://`)).toBe(false)
    expect(isAuthCallbackUrl(`${SCHEME}://open?${PROFILE_QUERY}`)).toBe(false)
    expect(isAuthCallbackUrl(`${SCHEME}://home?${PROFILE_QUERY}`)).toBe(false)
    expect(isAuthCallbackUrl(`${SCHEME}://homepage`)).toBe(true)
    expect(isAuthCallbackUrl(`${SCHEME}://auth/callback?code=a&state=b`)).toBe(true)
  })
})

describe('cold-start launch events are not lost before the renderer listens', () => {
  function fakeContents(loading: boolean) {
    const sent: unknown[] = []
    let onLoad: (() => void) | null = null
    const wc = {
      loading,
      isDestroyed: () => false,
      isLoadingMainFrame: () => wc.loading,
      send: (_channel: string, payload: unknown) => sent.push(payload),
      once: (_event: 'did-finish-load', listener: () => void) => {
        onLoad = listener
      },
      finishLoad: () => {
        wc.loading = false
        onLoad?.()
      },
    }
    return { wc, sent }
  }

  it('main keeps the latest event while the shell page loads and sends it once loaded', () => {
    const { wc, sent } = fakeContents(true)
    const push = createLaunchPusher(() => wc, 'uniwork-doc:launch-event')
    push({ phase: 'opening' })
    push({ phase: 'failed', error: 'ticket_invalid' })
    expect(sent).toEqual([])
    wc.finishLoad()
    expect(sent).toEqual([{ phase: 'failed', error: 'ticket_invalid' }])
    push({ phase: 'opening' })
    expect(sent).toHaveLength(2)
  })

  it('a live event supersedes the held one, so a later subscriber gets nothing stale', () => {
    const replay = createLaunchReplay<UniworkLaunchEvent>(() => 1_000)
    replay.deliver({ phase: 'needs-sign-in' })
    const first: UniworkLaunchEvent[] = []
    const off = replay.subscribe((e) => first.push(e))
    expect(first).toEqual([{ phase: 'needs-sign-in' }])
    replay.deliver({ phase: 'opening' })
    expect(first).toHaveLength(2)
    off()
    const second: UniworkLaunchEvent[] = []
    replay.subscribe((e) => second.push(e))
    expect(second).toEqual([])
  })

  it('every subscriber within the window gets the held cold-start event, in either order (R2-2)', () => {
    const replay = createLaunchReplay<UniworkLaunchEvent>(() => 1_000)
    replay.deliver({ phase: 'opening' })
    const notice: UniworkLaunchEvent[] = []
    const home: UniworkLaunchEvent[] = []
    replay.subscribe((e) => home.push(e))
    replay.subscribe((e) => notice.push(e))
    expect(home).toEqual([{ phase: 'opening' }])
    expect(notice).toEqual([{ phase: 'opening' }])
    // the other order
    const swapped = createLaunchReplay<UniworkLaunchEvent>(() => 1_000)
    swapped.deliver({ phase: 'needs-sign-in' })
    const a: UniworkLaunchEvent[] = []
    const b: UniworkLaunchEvent[] = []
    swapped.subscribe((e) => a.push(e))
    swapped.subscribe((e) => b.push(e))
    expect(a).toEqual([{ phase: 'needs-sign-in' }])
    expect(b).toEqual([{ phase: 'needs-sign-in' }])
  })

  it('the held event expires for every subscriber after the window (R2-2)', () => {
    let now = 1_000
    const replay = createLaunchReplay<UniworkLaunchEvent>(() => now)
    replay.deliver({ phase: 'opening' })
    const early: UniworkLaunchEvent[] = []
    replay.subscribe((e) => early.push(e))
    now += LAUNCH_REPLAY_MS + 1
    const late: UniworkLaunchEvent[] = []
    replay.subscribe((e) => late.push(e))
    expect(early).toHaveLength(1)
    expect(late).toEqual([])
    const again: UniworkLaunchEvent[] = []
    replay.subscribe((e) => again.push(e))
    expect(again).toEqual([])
  })

  it('a held event older than the ticket lifetime is not replayed', () => {
    let now = 1_000
    const replay = createLaunchReplay<UniworkLaunchEvent>(() => now)
    replay.deliver({ phase: 'failed', error: 'ticket_invalid' })
    now += LAUNCH_REPLAY_MS + 1
    const seen: UniworkLaunchEvent[] = []
    replay.subscribe((e) => seen.push(e))
    expect(seen).toEqual([])
  })
})

describe('the reveal push holder reports its outcome and can be dropped (D1-4)', () => {
  function fakeContents(loading: boolean) {
    const sent: unknown[] = []
    let onLoad: (() => void) | null = null
    const wc = {
      loading,
      isDestroyed: () => false,
      isLoadingMainFrame: () => wc.loading,
      send: (_channel: string, payload: unknown) => sent.push(payload),
      once: (_event: 'did-finish-load', listener: () => void) => {
        onLoad = listener
      },
      finishLoad: () => {
        wc.loading = false
        onLoad?.()
      },
    }
    return { wc, sent }
  }

  it('reports delivered / deferred / none', () => {
    const live = fakeContents(false)
    expect(createPushHolder<{ id: string }>(() => live.wc, 'c')({ id: 'a' })).toBe('delivered')
    expect(live.sent).toEqual([{ id: 'a' }])
    const loading = fakeContents(true)
    expect(createPushHolder<{ id: string }>(() => loading.wc, 'c')({ id: 'b' })).toBe('deferred')
    expect(loading.sent).toEqual([])
    expect(createPushHolder<{ id: string }>(() => null, 'c')({ id: 'c' })).toBe('none')
  })

  it('drops a deferred payload that is no longer wanted once the page finishes loading', () => {
    const { wc, sent } = fakeContents(true)
    const push = createPushHolder<{ id: string }>(
      () => wc,
      'c',
      () => false,
    )
    push({ id: 'a' })
    wc.finishLoad()
    expect(sent).toEqual([])
  })

  it('still sends the deferred payload while it is wanted', () => {
    const { wc, sent } = fakeContents(true)
    const push = createPushHolder<{ id: string }>(
      () => wc,
      'c',
      () => true,
    )
    push({ id: 'a' })
    wc.finishLoad()
    expect(sent).toEqual([{ id: 'a' }])
  })
})

describe('routing launch links next to the sign-in callback', () => {
  const launch = link(TICKET)
  const callback = 'uniwork-office://auth/callback?code=c&state=s'

  it('a launch link is not a sign-in callback', () => {
    expect(isAuthCallbackUrl(launch)).toBe(false)
    expect(isAuthCallbackUrl(link(TICKET, 'uniwork-office-dev'))).toBe(false)
    expect(isAuthCallbackUrl(callback)).toBe(true)
  })

  it('holds cold-start argv and early open-url links in order until the launch route starts', () => {
    const router = createAuthCallbackRouter(['app.exe', launch])
    const second = link(`ticket_${'b'.repeat(40)}`)
    expect(router.openUrl(second)).toBe(true)
    expect(router.pendingLaunch()).toBe(launch)
    const auth: string[] = []
    router.start((url) => auth.push(url))
    const routed: string[] = []
    router.startLaunch((url) => routed.push(url))
    expect(routed).toEqual([launch, second])
    expect(auth).toEqual([])
    expect(router.openUrl(callback)).toBe(true)
    expect(auth).toEqual([callback])
  })

  it('second instance: argv first, then the lock data', () => {
    const router = createAuthCallbackRouter([])
    const routed: string[] = []
    router.startLaunch((url) => routed.push(url))
    expect(router.secondInstance(['app.exe', launch], {})).toBe(true)
    expect(router.secondInstance(['app.exe'], { officeLaunchUrl: launch })).toBe(true)
    expect(router.secondInstance(['app.exe'], { launchUrl: 'uniwork://office/app' })).toBe(false)
    expect(routed).toEqual([launch, launch])
  })
})
