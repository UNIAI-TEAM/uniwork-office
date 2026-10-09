import type { UniworkDocErrorCode, UniworkLaunchEvent } from '../../shared/home-api'
import { UniworkDocError } from './errors'
import type { LaunchDescriptor } from './parse'

/**
 * "Open in desktop app" from the UniWork web: `uniwork-office[-dev]://open?ticket=`.
 * The parser is the only place a launch URL is read; the ticket is the one
 * value that crosses it, and a refusal never echoes the URL or the ticket.
 * The controller redeems each ticket at most once (in-flight + terminal
 * sets), holds a ticket in memory while the user signs in (within its 120 s
 * TTL), and treats a lost exchange response as terminal: a ticket is never
 * retried.
 */

const LAUNCH_HOST = 'open'
const TICKET_MAX = 192
const TICKET_MIN = 39
const TICKET = /^ticket_[A-Za-z0-9_-]{32,185}$/
export const LAUNCH_TICKET_TTL_MS = 120_000

export type DeepLinkRejectReason =
  | 'malformed_url'
  | 'wrong_scheme'
  | 'wrong_host'
  | 'wrong_path'
  | 'fragment_not_allowed'
  | 'missing_ticket'
  | 'duplicate_ticket'
  | 'unexpected_parameter'
  | 'oversized_ticket'
  | 'invalid_ticket'
  | 'login_code'

export type DeepLinkParseResult =
  Readonly<{ ok: true; ticket: string }> | Readonly<{ ok: false; reason: DeepLinkRejectReason }>

const reject = (reason: DeepLinkRejectReason): DeepLinkParseResult => ({ ok: false, reason })

/** `scheme` is the active channel's scheme (`uniwork-office` or `uniwork-office-dev`) */
export function parseOfficeDeepLink(value: unknown, scheme: string): DeepLinkParseResult {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    return reject('malformed_url')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return reject('malformed_url')
  }
  if (url.protocol !== `${scheme}:`) return reject('wrong_scheme')
  if (url.hostname !== LAUNCH_HOST || url.username || url.password || url.port) {
    return reject('wrong_host')
  }
  // `://open?ticket=` normalizes to an empty path; a single slash is the same
  if (url.pathname !== '' && url.pathname !== '/') return reject('wrong_path')
  if (url.hash || value.includes('#')) return reject('fragment_not_allowed')
  const params = [...url.searchParams.entries()]
  const tickets = params.filter(([key]) => key === 'ticket')
  if (tickets.length === 0) return reject('missing_ticket')
  if (tickets.length > 1) return reject('duplicate_ticket')
  if (params.some(([key]) => key !== 'ticket')) return reject('unexpected_parameter')
  const ticket = tickets[0]?.[1] ?? ''
  if (ticket.length > TICKET_MAX) return reject('oversized_ticket')
  if (/^(?:code|state|attempt)[_-]/i.test(ticket) || /^fake-code-/i.test(ticket)) {
    return reject('login_code')
  }
  if (ticket.length < TICKET_MIN || !TICKET.test(ticket)) return reject('invalid_ticket')
  return { ok: true, ticket }
}

export interface LaunchControllerDeps {
  /** the active channel's launch scheme, or null without a deployment profile */
  scheme(): string | null
  isSignedIn(): boolean
  /** the device session of the signed-in account (never a token) */
  identity(): { deviceSessionId: string; deploymentId: string } | null
  profile(): { deploymentId: string; clientId: string } | null
  exchange(input: {
    launchTicket: string
    deploymentId: string
    clientId: string
    deviceSessionId: string
  }): Promise<LaunchDescriptor>
  /** the normal open flow with the descriptor's workspace and operation */
  open(descriptor: LaunchDescriptor): Promise<{ path: string; title: string }>
  emit(event: UniworkLaunchEvent): void
  /** brings the shell window to the front */
  reveal(): void
  now?(): number
  ttlMs?: number
}

function codeOf(error: unknown): UniworkDocErrorCode {
  return error instanceof UniworkDocError ? error.code : 'server_error'
}

export class LaunchController {
  private readonly deps: LaunchControllerDeps
  private readonly inFlight = new Set<string>()
  private readonly terminal = new Set<string>()
  private held: {
    ticket: string
    receivedAt: number
    timer: ReturnType<typeof setTimeout>
  } | null = null
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(deps: LaunchControllerDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.ttlMs = deps.ttlMs ?? LAUNCH_TICKET_TTL_MS
  }

  /** one delivery of a launch URL (argv, second instance, open-url) */
  async handleUrl(url: string): Promise<void> {
    this.deps.reveal()
    const scheme = this.deps.scheme()
    const parsed = scheme ? parseOfficeDeepLink(url, scheme) : reject('wrong_scheme')
    if (!parsed.ok) {
      this.deps.emit({ phase: 'failed', error: 'ticket_invalid' })
      return
    }
    const { ticket } = parsed
    // the same link delivered twice (argv + open-url, a double click) redeems once
    if (this.terminal.has(ticket) || this.inFlight.has(ticket) || this.held?.ticket === ticket) {
      return
    }
    if (!this.deps.isSignedIn()) {
      this.hold(ticket)
      this.deps.emit({ phase: 'needs-sign-in' })
      return
    }
    await this.redeem(ticket)
  }

  /** the account became signed in: redeem the held ticket if it is still within its TTL */
  async onSignedIn(): Promise<void> {
    const held = this.held
    if (!held) return
    this.held = null
    clearTimeout(held.timer)
    if (this.now() - held.receivedAt >= this.ttlMs) {
      this.terminal.add(held.ticket)
      this.deps.emit({ phase: 'failed', error: 'ticket_expired' })
      return
    }
    await this.redeem(held.ticket)
  }

  dispose(): void {
    if (this.held) clearTimeout(this.held.timer)
    this.held = null
  }

  private hold(ticket: string): void {
    if (this.held) {
      clearTimeout(this.held.timer)
      this.terminal.add(this.held.ticket)
    }
    const timer = setTimeout(() => {
      if (this.held?.ticket !== ticket) return
      this.held = null
      this.terminal.add(ticket)
      this.deps.emit({ phase: 'failed', error: 'ticket_expired' })
    }, this.ttlMs)
    ;(timer as { unref?: () => void }).unref?.()
    // memory only: a held ticket is never written anywhere
    this.held = { ticket, receivedAt: this.now(), timer }
  }

  private async redeem(ticket: string): Promise<void> {
    const identity = this.deps.identity()
    const profile = this.deps.profile()
    if (!identity || !profile) {
      this.hold(ticket)
      this.deps.emit({ phase: 'needs-sign-in' })
      return
    }
    this.inFlight.add(ticket)
    this.deps.emit({ phase: 'opening' })
    let descriptor: LaunchDescriptor
    try {
      if (identity.deploymentId !== profile.deploymentId) {
        throw new UniworkDocError('wrong_deployment')
      }
      descriptor = await this.deps.exchange({
        launchTicket: ticket,
        deploymentId: profile.deploymentId,
        clientId: profile.clientId,
        deviceSessionId: identity.deviceSessionId,
      })
    } catch (error) {
      this.deps.emit({ phase: 'failed', error: codeOf(error) })
      return
    } finally {
      // terminal whatever happened: a lost response may have redeemed it
      this.inFlight.delete(ticket)
      this.terminal.add(ticket)
    }
    this.deps.emit({ phase: 'opening', title: descriptor.title })
    try {
      const opened = await this.deps.open(descriptor)
      this.deps.emit({ phase: 'opened', path: opened.path, title: opened.title })
    } catch (error) {
      this.deps.emit({ phase: 'failed', error: codeOf(error) })
    }
  }
}
