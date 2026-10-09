import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkLaunchEvent } from '../src/shared/home-api'
import { createAuthCallbackRouter } from '../src/main/uniwork-auth/routing'
import { isAuthCallbackUrl } from '../src/main/uniwork-auth/callback'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import {
  LAUNCH_TICKET_TTL_MS,
  LaunchController,
  parseOfficeDeepLink,
} from '../src/main/uniwork-docs/launch'
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
    expect(parseOfficeDeepLink(url, SCHEME)).toEqual({ ok: true, ticket: expected.ticket })
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
    expect(parseOfficeDeepLink(`${SCHEME}://open`, SCHEME)).toEqual({
      ok: false,
      reason: 'missing_ticket',
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

  it('a session of another deployment never exchanges', async () => {
    const events: UniworkLaunchEvent[] = []
    const exchange = vi.fn()
    const controller = new LaunchController({
      scheme: () => SCHEME,
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
