import type { UniworkDocErrorCode, UniworkLaunchEvent } from '../../shared/home-api'
import {
  callbackSchemeForChannel,
  isChannel,
  parseDeploymentProfile,
  type DeploymentProfile,
} from '../uniwork-auth/deployment'
import type { ProfileOutcome } from '../uniwork-auth/profile-store'
import { UniworkDocError } from './errors'
import type { LaunchDescriptor } from './parse'

/**
 * "Open in desktop app" from the UniWork web:
 * `uniwork-office[-dev]://open?ticket=<t>&deploymentId=&apiOrigin=&clientId=&channel=`.
 * The four profile parameters are all-or-nothing (the server the link was made
 * on); a link without them is the older ticket-only form. `home` (the web's
 * "Open UniWork Office") is the same without a ticket: it opens the home
 * screen and may carry the profile. `open` or `home` with nothing, or a bare
 * scheme, only brings the window forward.
 * The parser is the only place a launch URL is read; the ticket and the
 * profile are the values that cross it, and a refusal never echoes the URL,
 * the ticket or the profile.
 * The controller redeems each ticket at most once (in-flight + terminal
 * sets), holds a ticket in memory while the user signs in (within its 120 s
 * TTL), and treats a lost exchange response as terminal: a ticket is never
 * retried.
 */

const LAUNCH_HOST = 'open'
const HOME_HOST = 'home'
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
  | 'duplicate_ticket'
  | 'duplicate_parameter'
  | 'partial_profile'
  | 'invalid_profile'
  | 'unexpected_parameter'
  | 'oversized_ticket'
  | 'invalid_ticket'
  | 'login_code'

export type DeepLinkParseResult =
  | Readonly<{ ok: true; ticket: string | null; profile: DeploymentProfile | null }>
  | Readonly<{ ok: false; reason: DeepLinkRejectReason }>

const PROFILE_KEYS = ['deploymentId', 'apiOrigin', 'clientId', 'channel'] as const

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
  if (url.username || url.password || url.port) return reject('wrong_host')
  // a bare `scheme://` only brings the window forward
  if (
    url.hostname === '' &&
    url.pathname === '' &&
    !url.search &&
    !url.hash &&
    !value.includes('?')
  ) {
    return { ok: true, ticket: null, profile: null }
  }
  if (url.hostname !== LAUNCH_HOST && url.hostname !== HOME_HOST) return reject('wrong_host')
  // `://open?ticket=` normalizes to an empty path; a single slash is the same
  if (url.pathname !== '' && url.pathname !== '/') return reject('wrong_path')
  if (url.hash || value.includes('#')) return reject('fragment_not_allowed')
  const params = [...url.searchParams.entries()]
  // the home route names no document, so it never carries a ticket
  const known = new Set<string>(url.hostname === HOME_HOST ? PROFILE_KEYS : ['ticket', ...PROFILE_KEYS])
  if (params.some(([key]) => !known.has(key))) return reject('unexpected_parameter')
  const tickets = params.filter(([key]) => key === 'ticket')
  if (tickets.length > 1) return reject('duplicate_ticket')
  for (const key of PROFILE_KEYS) {
    if (params.filter(([name]) => name === key).length > 1) return reject('duplicate_parameter')
  }
  const profile = profileOf(params, scheme)
  if (profile === 'partial') return reject('partial_profile')
  if (profile === 'invalid') return reject('invalid_profile')
  if (tickets.length === 0) return { ok: true, ticket: null, profile }
  const ticket = tickets[0]?.[1] ?? ''
  if (ticket.length > TICKET_MAX) return reject('oversized_ticket')
  if (/^(?:code|state|attempt)[_-]/i.test(ticket) || /^fake-code-/i.test(ticket)) {
    return reject('login_code')
  }
  if (ticket.length < TICKET_MIN || !TICKET.test(ticket)) return reject('invalid_ticket')
  return { ok: true, ticket, profile }
}

/** the four profile parameters: none -> null, some -> 'partial', all -> parsed or 'invalid' */
function profileOf(
  params: readonly (readonly [string, string])[],
  scheme: string,
): DeploymentProfile | null | 'partial' | 'invalid' {
  const found = PROFILE_KEYS.filter((key) => params.some(([name]) => name === key))
  if (found.length === 0) return null
  if (found.length !== PROFILE_KEYS.length) return 'partial'
  const value = (key: string) => params.find(([name]) => name === key)?.[1] ?? ''
  const channel = value('channel')
  if (!isChannel(channel)) return 'invalid'
  const profile = parseDeploymentProfile({
    deploymentId: value('deploymentId'),
    apiOrigin: value('apiOrigin'),
    clientId: value('clientId'),
    channel,
  })
  // the link must be addressed to the scheme it arrived on
  return profile && callbackSchemeForChannel(channel) === scheme ? profile : 'invalid'
}

/** the slice of the shell window's WebContents a launch push needs */
export interface LaunchPushTarget {
  isDestroyed(): boolean
  isLoadingMainFrame(): boolean
  send(channel: string, payload: unknown): void
  once(event: 'did-finish-load', listener: () => void): unknown
}

/**
 * Launch events of a cold start arrive before the shell page has loaded; a
 * send then is lost. While the page loads the latest event is kept and sent
 * once it finished loading (the preload holds it until the renderer
 * subscribes).
 */
export function createLaunchPusher(
  target: () => LaunchPushTarget | null,
  channel: string,
): (event: UniworkLaunchEvent) => void {
  let held: UniworkLaunchEvent | null = null
  return (event) => {
    const wc = target()
    if (!wc || wc.isDestroyed()) return
    if (!wc.isLoadingMainFrame()) {
      wc.send(channel, event)
      return
    }
    const waiting = held !== null
    held = event
    if (waiting) return
    wc.once('did-finish-load', () => {
      const latest = held
      held = null
      if (latest && !wc.isDestroyed()) wc.send(channel, latest)
    })
  }
}

export interface LaunchControllerDeps {
  /** this build's launch scheme (known before any server is chosen) */
  scheme(): string
  /**
   * The server a link names: applied (with the confirm / sign-out rules)
   * before its ticket is redeemed. Anything but applied / unchanged drops the link.
   */
  applyProfile(profile: DeploymentProfile): Promise<ProfileOutcome>
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
    const parsed = parseOfficeDeepLink(url, scheme)
    if (!parsed.ok) {
      this.deps.emit({ phase: 'failed', error: 'ticket_invalid' })
      return
    }
    const { ticket, profile } = parsed
    // the server first: a ticket for a refused or declined server is never held or redeemed
    if (profile) {
      const outcome = await this.deps.applyProfile(profile)
      if (outcome === 'refused') {
        if (ticket) this.deps.emit({ phase: 'failed', error: 'ticket_invalid' })
        return
      }
      if (outcome === 'declined') return
      // another server now: a ticket held for the old one is never sent to it
      if (outcome === 'applied') this.dropHeld()
    }
    if (!ticket) return
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

  private dropHeld(): void {
    if (!this.held) return
    clearTimeout(this.held.timer)
    this.terminal.add(this.held.ticket)
    this.held = null
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
      this.inFlight.delete(ticket)
      const code = codeOf(error)
      if (code === 'session_expired' || code === 'not_signed_in') {
        // the server's auth refuses before the ticket is consumed (and after
        // one refresh): the session restore failed or ended, so the ticket
        // waits for sign-in like a link received while signed out
        this.hold(ticket)
        this.deps.emit({ phase: 'needs-sign-in' })
        return
      }
      // terminal: a lost response may have redeemed it
      this.terminal.add(ticket)
      this.deps.emit({ phase: 'failed', error: code })
      return
    }
    this.inFlight.delete(ticket)
    this.terminal.add(ticket)
    this.deps.emit({ phase: 'opening', title: descriptor.title })
    try {
      const opened = await this.deps.open(descriptor)
      this.deps.emit({ phase: 'opened', path: opened.path, title: opened.title })
    } catch (error) {
      this.deps.emit({ phase: 'failed', error: codeOf(error) })
    }
  }
}
