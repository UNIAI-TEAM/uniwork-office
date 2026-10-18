import { randomUUID } from 'node:crypto'
import { isUniworkDocError, UniworkDocError } from '../uniwork-docs/errors'
import type { EditLockHeartbeat, EditLockTenure, UniworkEditLockClient } from './client'

/**
 * One desktop edit-lock session per open bound path (UNI-1645 EL-1(b)).
 * Clock and timers are injectable so tests stay deterministic.
 */

export type EditLockSessionPhase =
  | 'acquiring'
  | 'held'
  | 'other'
  | 'self_elsewhere'
  | 'free'
  | 'lost'
  | 'unreachable'
  | 'none'

export type EditLockLostReason =
  | 'released'
  | 'expired'
  | 'taken_over'
  | 'handed_over'
  | 'access_lost'
  | 'document_archived'
  | 'moved_here'
  | 'unknown'

export interface EditLockSessionView {
  phase: EditLockSessionPhase
  holderName: string | null
  since: string | null
  lostReason?: EditLockLostReason
  byName?: string | null
}

/** the session's HTTP surface (the edit-lock client, or a test fake) */
export interface EditLockTransport {
  getState(documentId: string): Promise<import('./client').EditLockState>
  acquire(
    input: { documentId: string; editorId: string },
    moveFromSelf?: boolean,
  ): Promise<EditLockTenure>
  heartbeat(input: { documentId: string; lockId: string }): Promise<EditLockHeartbeat>
  release(input: { documentId: string; lockId: string }): Promise<void>
}

export interface EditLockSessionOptions {
  documentId: string
  path: string
  editorId: string
  transport: EditLockTransport
  clock?: { now(): number }
  /** default: setTimeout; tests inject fake-timer sleep */
  sleep?(ms: number): Promise<void>
  isOnline?(): boolean
  isSignedIn?(): boolean
  onChange?(view: EditLockSessionView): void
}

const DEFAULT_HEARTBEAT_MS = 30_000
const DEFAULT_TTL_MS = 120_000
const SETTLE_MS = 300
const POLL_MS = 30_000

export function newEditorId(): string {
  return randomUUID()
}

export function asEditLockTransport(client: UniworkEditLockClient): EditLockTransport {
  return {
    getState: (documentId) => client.getState(documentId),
    acquire: (input, moveFromSelf) =>
      client.acquire({ ...input, ...(moveFromSelf ? { moveFromSelf: true } : {}) }),
    heartbeat: (input) => client.heartbeat(input),
    release: (input) => client.release(input),
  }
}

function arm(fn: () => void, ms: number): { cancel(): void } {
  const timer = setTimeout(fn, ms)
  ;(timer as { unref?: () => void }).unref?.()
  return { cancel: () => clearTimeout(timer) }
}

export class EditLockSession {
  readonly editorId: string
  readonly documentId: string
  readonly path: string
  private readonly transport: EditLockTransport
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly online: () => boolean
  private readonly signedIn: () => boolean
  private readonly onChange?: (view: EditLockSessionView) => void
  private state: EditLockSessionView = {
    phase: 'none',
    holderName: null,
    since: null,
  }
  private tenure: EditLockTenure | null = null
  private lastOk = 0
  private heartbeatMs = DEFAULT_HEARTBEAT_MS
  private ttlMs = DEFAULT_TTL_MS
  private beatTimer: { cancel(): void } | null = null
  private deadlineTimer: { cancel(): void } | null = null
  private pollTimer: { cancel(): void } | null = null
  private beating = false
  private pendingBeat = false
  private disposed = false
  private op = 0
  private releaseWarned = false
  private acquiring = false

  constructor(opts: EditLockSessionOptions) {
    this.documentId = opts.documentId
    this.path = opts.path
    this.editorId = opts.editorId
    this.transport = opts.transport
    this.now = () => opts.clock?.now() ?? Date.now()
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.online = opts.isOnline ?? (() => true)
    this.signedIn = opts.isSignedIn ?? (() => true)
    this.onChange = opts.onChange
  }

  view(): EditLockSessionView {
    return this.state
  }

  lockId(): string | null {
    return this.state.phase === 'held' ? (this.tenure?.lockId ?? null) : null
  }

  isEditable(): boolean {
    return (
      this.state.phase !== 'other' &&
      this.state.phase !== 'self_elsewhere' &&
      this.state.phase !== 'free' &&
      this.state.phase !== 'lost'
    )
  }

  isReadOnly(): boolean {
    return !this.isEditable()
  }

  async acquire(moveFromSelf = false): Promise<void> {
    if (this.disposed) return
    if (this.state.phase === 'held' && !moveFromSelf) return
    if (this.acquiring && !moveFromSelf) return
    const op = ++this.op
    this.acquiring = true
    this.clearTimers()
    this.setState({
      phase: 'acquiring',
      holderName: null,
      since: null,
      lostReason: undefined,
      byName: undefined,
    })
    try {
      await this.runAcquire(op, moveFromSelf, false)
    } finally {
      if (op === this.op) this.acquiring = false
    }
  }

  /** "Sửa ở đây": R2, with move_from_self only from self_elsewhere. Never automatic. */
  editHere(): Promise<void> {
    if (this.state.phase === 'self_elsewhere') return this.acquire(true)
    if (
      this.state.phase === 'other' ||
      this.state.phase === 'free' ||
      this.state.phase === 'lost' ||
      this.state.phase === 'unreachable' ||
      this.state.phase === 'none'
    ) {
      return this.acquire(false)
    }
    return Promise.resolve()
  }

  /**
   * Q2: the dispatcher / save-coordinator awaits this before the first queued
   * commit of an unreachable path. Granted -> 'held'; 423 -> 'park'.
   */
  async ensureHeldBeforeCommit(): Promise<'held' | 'park' | 'proceed'> {
    if (this.state.phase === 'unreachable' || this.state.phase === 'acquiring') {
      await this.acquire(false)
    }
    if (this.state.phase === 'held') return 'held'
    if (
      this.state.phase === 'other' ||
      this.state.phase === 'self_elsewhere' ||
      this.state.phase === 'free' ||
      this.state.phase === 'lost'
    ) {
      return 'park'
    }
    return 'proceed'
  }

  async wake(): Promise<void> {
    if (this.disposed) return
    switch (this.state.phase) {
      case 'held':
        if (this.expireIfDue()) return
        await this.beat()
        return
      case 'other':
        if (this.online() && this.signedIn()) {
          await this.poll()
          this.armPoll()
        }
        return
      case 'unreachable':
        if (this.online() && this.signedIn()) await this.acquire(false)
        return
      default:
        return
    }
  }

  async release(): Promise<void> {
    if (this.disposed) return
    this.op += 1
    this.clearTimers()
    const lock = this.state.phase === 'held' ? this.tenure : null
    // never on 'lost'
    if (this.state.phase === 'lost' || !lock) {
      this.setState({ phase: 'none', holderName: null, since: null })
      return
    }
    this.setState({ phase: 'none', holderName: null, since: null })
    this.tenure = null
    try {
      await this.transport.release({ documentId: this.documentId, lockId: lock.lockId })
    } catch (error) {
      if (!this.releaseWarned) {
        this.releaseWarned = true
        console.warn(
          `uniwork edit-lock: release failed for ${this.documentId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
  }

  markLostFromCommit(error: UniworkDocError): void {
    if (this.disposed || this.state.phase !== 'held') return
    this.op += 1
    this.lose(error.lostReason ?? 'unknown', error.byName ?? error.editLock?.holderName ?? null)
  }

  dispose(): void {
    this.disposed = true
    this.op += 1
    this.clearTimers()
  }

  private async runAcquire(op: number, moveFromSelf: boolean, retried: boolean): Promise<void> {
    const sentAt = this.now()
    try {
      const lock = await this.transport.acquire(
        { documentId: this.documentId, editorId: this.editorId },
        moveFromSelf,
      )
      if (op !== this.op || this.disposed) {
        await this.transport
          .release({ documentId: this.documentId, lockId: lock.lockId })
          .catch(() => undefined)
        return
      }
      this.grant(lock, sentAt)
    } catch (error) {
      if (op !== this.op || this.disposed) return
      if (isUniworkDocError(error) && error.code === 'edit_locked') {
        const heldByMe = error.editLock?.heldByMe === true
        if (heldByMe && !moveFromSelf && !retried) {
          await this.sleep(SETTLE_MS)
          if (op !== this.op || this.disposed) return
          return this.runAcquire(op, moveFromSelf, true)
        }
        this.clearTimers()
        this.setState({
          phase: heldByMe ? 'self_elsewhere' : 'other',
          holderName: error.editLock?.holderName ?? null,
          since: error.editLock?.since ?? null,
        })
        if (!heldByMe) this.armPoll()
        return
      }
      if (
        isUniworkDocError(error) &&
        (error.code === 'forbidden' || error.code === 'permission_revoked' || error.status === 403)
      ) {
        this.clearTimers()
        this.setState({ phase: 'none', holderName: null, since: null })
        return
      }
      this.applyAcquireUnreachable(error)
    }
  }

  /**
   * Interim (user 2026-10-18, EL-1b Q2): EL-2 switches offline opens to
   * read-only + offline hold per UNI-1645 D1.
   */
  private applyAcquireUnreachable(_error: unknown): void {
    this.clearTimers()
    this.setState({ phase: 'unreachable', holderName: null, since: null })
  }

  private grant(lock: EditLockTenure, sentAt: number): void {
    this.tenure = lock
    this.heartbeatMs = lock.heartbeatIntervalMs || DEFAULT_HEARTBEAT_MS
    this.ttlMs = lock.ttlMs || DEFAULT_TTL_MS
    this.lastOk = sentAt
    this.clearTimers()
    this.setState({
      phase: 'held',
      holderName: null,
      since: null,
      lostReason: undefined,
      byName: undefined,
    })
    this.scheduleBeat()
  }

  private scheduleBeat(): void {
    this.beatTimer?.cancel()
    this.deadlineTimer?.cancel()
    this.beatTimer = arm(() => void this.beat(), this.heartbeatMs)
    const left = Math.max(0, this.ttlMs - (this.now() - this.lastOk))
    this.deadlineTimer = arm(() => {
      this.expireIfDue()
    }, left)
  }

  private expireIfDue(): boolean {
    if (this.state.phase !== 'held' || this.now() - this.lastOk < this.ttlMs) return false
    this.lose('expired', null)
    return true
  }

  private async beat(): Promise<void> {
    const lock = this.tenure
    if (this.disposed || this.state.phase !== 'held' || !lock) return
    if (this.beating) {
      this.pendingBeat = true
      return
    }
    if (this.expireIfDue()) return
    this.beating = true
    const sentAt = this.now()
    try {
      const hb = await this.transport.heartbeat({
        documentId: this.documentId,
        lockId: lock.lockId,
      })
      if (this.state.phase !== 'held' || this.tenure?.lockId !== lock.lockId) return
      if (hb.lockId === lock.lockId) {
        this.lastOk = sentAt
        this.tenure = { ...lock, expiresAt: hb.expiresAt }
      }
    } catch (error) {
      if (this.state.phase !== 'held' || this.tenure?.lockId !== lock.lockId) return
      if (this.loseFrom(error)) return
    } finally {
      this.beating = false
      const again = this.pendingBeat
      this.pendingBeat = false
      if (again && this.state.phase === 'held' && !this.disposed) {
        await this.beat()
        return
      }
    }
    if (this.state.phase === 'held' && !this.disposed && !this.expireIfDue()) {
      this.scheduleBeat()
    }
  }

  private loseFrom(error: unknown): boolean {
    if (isUniworkDocError(error) && error.serverCode === 'edit_lock_lost') {
      this.lose(error.lostReason ?? 'unknown', error.byName ?? null)
      return true
    }
    if (isUniworkDocError(error) && (error.code === 'forbidden' || error.code === 'not_found')) {
      this.lose('access_lost', null)
      return true
    }
    return false
  }

  private lose(reason: EditLockLostReason, byName: string | null): void {
    this.clearTimers()
    this.tenure = null
    this.setState({
      phase: 'lost',
      holderName: null,
      since: null,
      lostReason: reason,
      ...(byName ? { byName } : { byName: null }),
    })
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.state.phase !== 'other') return
    if (!this.online() || !this.signedIn()) return
    try {
      const state = await this.transport.getState(this.documentId)
      if (this.disposed || this.state.phase !== 'other') return
      if (!state.lock) {
        this.clearTimers()
        this.setState({ phase: 'free', holderName: null, since: null })
      }
    } catch {
      // stay in 'other'; the next tick or wake retries
    }
  }

  private armPoll(): void {
    this.pollTimer?.cancel()
    this.pollTimer = null
    if (this.disposed || this.state.phase !== 'other') return
    if (!this.online() || !this.signedIn()) return
    this.pollTimer = arm(() => {
      void this.poll().finally(() => this.armPoll())
    }, POLL_MS)
  }

  private clearTimers(): void {
    this.beatTimer?.cancel()
    this.deadlineTimer?.cancel()
    this.pollTimer?.cancel()
    this.beatTimer = this.deadlineTimer = this.pollTimer = null
  }

  private setState(patch: Partial<EditLockSessionView>): void {
    if (this.disposed) return
    const next: EditLockSessionView = { ...this.state, ...patch }
    if (next.phase !== 'lost') {
      delete next.lostReason
      delete next.byName
    }
    this.state = next
    this.onChange?.(next)
  }
}
