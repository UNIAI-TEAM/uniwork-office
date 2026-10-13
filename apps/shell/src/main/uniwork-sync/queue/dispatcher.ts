import { randomUUID } from 'node:crypto'
import type { CommitLookup } from '../../uniwork-docs/parse'
import { UniworkDocError } from '../../uniwork-docs/errors'
import type { DocLock } from '../doc-lock'
import { QUEUE_LIMITS, type QueueLimits } from './limits'
import {
  transition,
  type NewIntentInput,
  type QueueContext,
  type QueueEvent,
  type TransitionResult,
} from './machine'
import type { IntentRecordV2, QueueState } from './record'

/**
 * The G5-06 durable save queue engine: it turns a stored `IntentRecordV2` into
 * UniWork commits. Every record change goes through the pure `transition()`;
 * this class only performs the effects (network, lock, store, drafts, pause)
 * and persists what the machine returned. Everything it touches is injected
 * (clock, random, client, capability, lock, intents, drafts, pause) and it
 * starts no timers of its own, so the whole EXPERIENCE behaviour is driven
 * deterministically from a test.
 *
 * One lane per org: an intent is always dispatched under the capability of ITS
 * org (`sync_write` false parks it `paused_admin`, a never-read capability
 * allows the write, a stale read past its TTL while offline is `paused_offline`).
 * At most `concurrency` documents are in flight, and each document holds its
 * `DocLock` before a byte moves; a lock it no longer owns stops it before the
 * commit.
 */

/** the client surface the queue drives: upload, commit and the commit lookup */
export interface QueueClient {
  upload(input: {
    documentId: string
    bytes: Uint8Array
    filename: string
    format: string
    idempotencyKey: string
  }): Promise<{ uploadId: string; checksumSha256: string }>
  commit(input: {
    documentId: string
    uploadId: string
    baseRevision: string
    idempotencyKey: string
  }): Promise<{ versionId: string; version: number; revision: string }>
  lookupCommit(input: { documentId: string; idempotencyKey: string }): Promise<CommitLookup>
}

/** what the queue needs to persist one record (the G5-04 intent store, v2 path) */
export interface QueueIntents {
  read(
    documentKey: string,
    facts: { orgId: string; workspaceId: string; baseVersion: number; length: number },
  ): Promise<{ intent: IntentRecordV2; payload: Uint8Array } | null>
  put(documentKey: string, intent: IntentRecordV2, payload: Uint8Array): Promise<{ kind: string }>
  delete(documentKey: string): Promise<void>
}

/** one queue document: its record, the exact bytes it uploads and its file */
export interface QueueDoc {
  key: string
  path: string
  filename: string
  format: string
  /** the account binding the record belongs to; '' when the folder is unknown */
  orgId: string
  workspaceId: string
  baseVersion: number
  record: IntentRecordV2
  payload: Uint8Array
}

/** the dispatcher's view of the account's kept-draft store */
export interface QueueDrafts {
  keep(
    documentKey: string,
    snapshot: Uint8Array,
    meta: { id: string; createdAt: string; title?: string },
  ): Promise<'ok' | 'drafts_full' | 'store_full' | 'keystore_locked'>
}

/** the dispatcher's view of the account's durable "pause sending" flag */
export interface QueuePause {
  isPaused(): Promise<boolean>
  setPaused(paused: boolean): Promise<{ kind: string }>
}

export type QueueCapabilityRead =
  | { kind: 'ok'; capabilities: { sync_write: boolean }; source: string }
  | { kind: 'session_expired'; capabilities: { sync_write: boolean }; source: string }

/** the org's capability verdict for one lane, per pass */
export type LaneVerdict = 'ok' | 'sync_write_off' | 'offline' | 'session_expired'

export interface QueueDispatcherDeps {
  /** the queue's intent store, or why it cannot be reached right now */
  intents(): Promise<
    { kind: 'ok'; intents: QueueIntents } | { kind: 'keystore_locked' } | { kind: 'unavailable' }
  >
  client: QueueClient
  capability: { get(orgId: string): Promise<QueueCapabilityRead> }
  lock: DocLock
  /** the per-account "pause sending" flag (defaults to "not paused") */
  pause?: QueuePause
  /** the kept-draft store (defaults to a no-op: no draft is ever kept) */
  drafts?: QueueDrafts
  clock(): number
  random?(): number
  limits?: QueueLimits
  /** status push for every record change; the front maps a record to a chip */
  publish(record: IntentRecordV2): void
  uuid?(): string
}

/** what one pass did, for the caller (tests and the poll) */
export interface DispatchResult {
  /** documents that moved bytes or were settled */
  dispatched: number
  /** documents skipped because the lane is paused, locked or over concurrency */
  parked: number
  /** the state each document ended the pass in, by document key */
  outcomes: Map<string, QueueState>
}

/** the identity of a freshly minted intent; the front fills the binding facts */
export interface MintedIntent {
  intentId: string
  idempotencyKey: string
  documentId: string
  orgId: string
  workspaceId: string
  baseRevision: string
  baseVersion: number
  checksum: string
  length: number
}

export class QueueDispatcher {
  private readonly deps: QueueDispatcherDeps
  private readonly limits: QueueLimits
  private readonly random: () => number
  private readonly uuid: () => string
  /** documents whose upload/commit is in flight right now */
  private readonly committing = new Set<string>()
  /** documents parked read-only because another window holds the lock */
  private readonly otherWindow = new Set<string>()

  constructor(deps: QueueDispatcherDeps) {
    this.deps = deps
    this.limits = deps.limits ?? QUEUE_LIMITS
    this.random = deps.random ?? Math.random
    this.uuid = deps.uuid ?? randomUUID
  }

  /** whether another window holds the document lock (this window is read-only) */
  isOtherWindow(key: string): boolean {
    return this.otherWindow.has(key)
  }

  /**
   * Mint the v2 record of one Ctrl/Cmd+S: its state is the lane's verdict
   * (offline wins over a known-off capability, a user pause parks it, a
   * never-read capability allows the write).
   */
  async mint(intent: MintedIntent): Promise<IntentRecordV2> {
    const now = this.deps.clock()
    const context: QueueContext = {
      now,
      limits: this.limits,
      random: this.random,
      pausedUser: await this.userPaused(),
    }
    const verdict = await this.readCapability(intent.orgId)
    if (verdict === 'sync_write_off') context.syncWrite = false
    if (verdict === 'offline') context.online = false
    const result = transition(null, { type: 'save', intent: toNewIntent(intent) }, context)
    if (!result.record) throw new Error('the queue machine refused the save')
    return result.record
  }

  /** persist a freshly minted record and publish it (the Ctrl/Cmd+S hand-off) */
  async enqueue(doc: QueueDoc): Promise<QueueState> {
    const access = await this.deps.intents()
    if (access.kind !== 'ok') {
      this.deps.publish(doc.record)
      return doc.record.state
    }
    const written = await access.intents.put(doc.key, doc.record, doc.payload)
    this.deps.publish(doc.record)
    if (written.kind !== 'ok') return doc.record.state
    return doc.record.state
  }

  /**
   * One poll pass: for each org lane read the org's capability once and settle
   * or advance every pending document of that lane.
   */
  async dispatchAll(docs: QueueDoc[], now = this.deps.clock()): Promise<DispatchResult> {
    const outcomes = new Map<string, QueueState>()
    let dispatched = 0
    let parked = 0
    const lanes = new Map<string, QueueDoc[]>()
    for (const doc of docs) {
      const lane = lanes.get(doc.orgId) ?? []
      lane.push(doc)
      lanes.set(doc.orgId, lane)
    }
    for (const [orgId, lane] of lanes) {
      const verdict = await this.readCapability(orgId)
      if (verdict !== 'ok') {
        for (const doc of lane) {
          if (verdict === 'session_expired') {
            await this.apply(doc, { type: 'commitFailed', error: 'session_expired' }, now)
          } else if (verdict === 'sync_write_off') {
            await this.apply(doc, { type: 'capability', syncWrite: false }, now)
          } else {
            await this.apply(doc, { type: 'online', online: false }, now)
          }
          outcomes.set(doc.key, doc.record.state)
          parked += 1
        }
        continue
      }
      let inFlight = 0
      for (const doc of lane) {
        if (!this.isDispatchable(doc.record.state) || this.committing.has(doc.key)) {
          outcomes.set(doc.key, doc.record.state)
          continue
        }
        if (doc.record.retryAt !== undefined && now < Date.parse(doc.record.retryAt)) {
          outcomes.set(doc.key, doc.record.state)
          parked += 1
          continue
        }
        if (inFlight >= this.limits.concurrency) {
          outcomes.set(doc.key, doc.record.state)
          parked += 1
          continue
        }
        outcomes.set(doc.key, await this.runOne(doc, now))
        dispatched += 1
        inFlight += 1
      }
    }
    return { dispatched, parked, outcomes }
  }

  /** drive the time-based rules of every reconciling document (no timers inside) */
  async tick(docs: QueueDoc[], now = this.deps.clock()): Promise<DispatchResult> {
    const outcomes = new Map<string, QueueState>()
    let dispatched = 0
    for (const doc of docs) {
      if (doc.record.state !== 'reconciling' && doc.record.state !== 'reconciling-stuck') {
        continue
      }
      const result = await this.apply(doc, { type: 'tick', now }, now)
      outcomes.set(doc.key, doc.record.state)
      if (result.effects.some((effect) => effect.kind === 'lookup')) {
        await this.reconcile(doc, now)
        outcomes.set(doc.key, doc.record.state)
        dispatched += 1
      }
    }
    return { dispatched, parked: 0, outcomes }
  }

  /**
   * Reconcile a document whose commit outcome is unknown: exactly one lookup
   * per call, never a new attempt, never a re-uploaded byte.
   */
  async reconcile(doc: QueueDoc, now = this.deps.clock()): Promise<QueueState> {
    let lookup: CommitLookup
    try {
      lookup = await this.deps.client.lookupCommit({
        documentId: doc.record.documentId,
        idempotencyKey: doc.record.idempotencyKey,
      })
    } catch (error) {
      const code = error instanceof UniworkDocError ? error.code : 'server_error'
      if (code === 'keystore_locked' || code === 'store_full') return doc.record.state
      await this.apply(doc, { type: 'lookup', error: code }, now)
      return doc.record.state
    }
    const event: QueueEvent =
      lookup.outcome === 'committed'
        ? { type: 'lookup', outcome: 'committed', receipt: lookup.receipt }
        : { type: 'lookup', outcome: lookup.outcome }
    const result = await this.apply(doc, event, now)
    if (result.record?.state === 'committed') await this.finishCleanup(doc)
    return doc.record.state
  }

  /** the user's "Kiem tra lai" (check again): a lookup only, never a new attempt */
  async recheck(doc: QueueDoc, now = this.deps.clock()): Promise<QueueState> {
    return this.reconcile(doc, now)
  }

  /** "Tam dung gui": the durable per-account pause flag (nothing is deleted) */
  async pause(): Promise<void> {
    await this.deps.pause?.setPaused(true)
  }

  /** "Tiep tuc gui": clear the flag and move waiting intents back to queued */
  async resume(docs: QueueDoc[], now = this.deps.clock()): Promise<QueueState[]> {
    await this.deps.pause?.setPaused(false)
    const states: QueueState[] = []
    for (const doc of docs) {
      await this.apply(doc, { type: 'resume' }, now)
      states.push(doc.record.state)
    }
    return states
  }

  /**
   * "Huy lan luu": only an intent that provably did not commit. When the
   * document is closed its snapshot becomes a kept draft; a draft the store
   * refused (the cap or the budget) leaves the intent exactly as it was.
   */
  async cancel(
    doc: QueueDoc,
    options: { documentClosed: boolean; title?: string; now?: number } = { documentClosed: false },
  ): Promise<QueueState> {
    const now = options.now ?? this.deps.clock()
    const result = await this.apply(doc, { type: 'cancel' }, now)
    if (result.record?.state !== 'cancelled') return doc.record.state
    if (options.documentClosed && this.deps.drafts) {
      const kept = await this.deps.drafts.keep(doc.key, doc.payload, {
        id: this.uuid(),
        createdAt: new Date(now).toISOString(),
        ...(options.title ? { title: options.title } : {}),
      })
      if (kept !== 'ok') {
        // the cap or the budget refused the draft: the intent is kept, not lost
        doc.record = { ...doc.record, state: 'failed' }
        this.deps.publish(doc.record)
        return doc.record.state
      }
    }
    await this.forget(doc)
    return 'cancelled'
  }

  /** "Bo lan luu..." on a stuck intent: the snapshot becomes a kept draft */
  async discard(doc: QueueDoc, options: { title?: string; now?: number } = {}): Promise<QueueState> {
    const now = options.now ?? this.deps.clock()
    const result = await this.apply(doc, { type: 'discard' }, now)
    if (result.record?.state !== 'cancelled') return doc.record.state
    if (this.deps.drafts) {
      const kept = await this.deps.drafts.keep(doc.key, doc.payload, {
        id: this.uuid(),
        createdAt: new Date(now).toISOString(),
        ...(options.title ? { title: options.title } : {}),
      })
      if (kept !== 'ok') {
        doc.record = { ...doc.record, state: 'reconciling-stuck' }
        this.deps.publish(doc.record)
        return doc.record.state
      }
    }
    await this.forget(doc)
    return 'cancelled'
  }

  /** Overwrite / Reload / "Luu lai": the old intent is superseded BEFORE a new one */
  async supersede(doc: QueueDoc, now = this.deps.clock()): Promise<QueueState> {
    const result = await this.apply(doc, { type: 'supersede' }, now)
    return result.record?.state ?? doc.record.state
  }

  /** the document is gone (tombstone): stop replay, keep the snapshot */
  async tombstone(doc: QueueDoc, now = this.deps.clock()): Promise<QueueState> {
    const result = await this.apply(doc, { type: 'tombstone' }, now)
    return result.record?.state ?? doc.record.state
  }

  /** the record as it is stored now, upgraded to v2 with the binding facts */
  async readState(doc: QueueDoc): Promise<QueueState> {
    const access = await this.deps.intents()
    if (access.kind !== 'ok') return doc.record.state
    const stored = await access.intents.read(doc.key, {
      orgId: doc.orgId,
      workspaceId: doc.workspaceId,
      baseVersion: doc.baseVersion,
      length: doc.record.length,
    })
    return stored?.intent.state ?? doc.record.state
  }

  // ---- internals -----------------------------------------------------------

  private isDispatchable(state: QueueState): boolean {
    return state === 'queued' || state === 'paused_offline'
  }

  /** one document through validate -> upload -> lock check -> commit */
  private async runOne(doc: QueueDoc, now: number): Promise<QueueState> {
    const lock = await this.deps.lock.acquire(doc.key)
    if (lock.kind === 'other_window') {
      // another window edits this document: this one is read-only, never writes
      this.otherWindow.add(doc.key)
      return doc.record.state
    }
    this.otherWindow.delete(doc.key)
    const generation = lock.generation
    const stopBeat = this.startHeartbeat(doc.key, generation)
    this.committing.add(doc.key)
    try {
      // validation passed: the first `uploaded` advances validating -> uploading
      await this.apply(doc, { type: 'dispatch' }, now)
      await this.apply(doc, { type: 'uploaded' }, now)
      let upload: { uploadId: string; checksumSha256: string }
      try {
        upload = await this.deps.client.upload({
          documentId: doc.record.documentId,
          bytes: doc.payload,
          filename: doc.filename,
          format: doc.format,
          idempotencyKey: doc.record.idempotencyKey,
        })
      } catch (error) {
        await this.failCommit(doc, error, now)
        return doc.record.state
      }
      if (upload.checksumSha256 !== doc.record.checksum) {
        await this.failCommit(
          doc,
          new UniworkDocError('malformed_response', { serverCode: 'upload_checksum_mismatch' }),
          now,
        )
        return doc.record.state
      }
      // the bytes are staged: the second `uploaded` advances uploading -> committing
      await this.apply(doc, { type: 'uploaded' }, now)
      // the capability can flip off mid-upload: stop before commit, same intent
      if ((await this.readCapability(doc.orgId)) === 'sync_write_off') {
        await this.apply(doc, { type: 'capability', syncWrite: false }, now)
        return doc.record.state
      }
      // a lost generation (another window took the lock) stops before commit
      if (!(await this.deps.lock.check(doc.key, generation))) {
        this.otherWindow.add(doc.key)
        await this.apply(doc, { type: 'commitFailed', error: 'other_window' }, now)
        return doc.record.state
      }
      let receipt: { versionId: string; version: number; revision: string }
      try {
        receipt = await this.deps.client.commit({
          documentId: doc.record.documentId,
          uploadId: upload.uploadId,
          baseRevision: doc.record.baseRevision,
          idempotencyKey: doc.record.idempotencyKey,
        })
      } catch (error) {
        await this.failCommit(doc, error, now)
        return doc.record.state
      }
      const result = await this.apply(doc, { type: 'committed', receipt }, now)
      if (result.record?.state === 'committed') await this.finishCleanup(doc)
      return doc.record.state
    } finally {
      stopBeat()
      this.committing.delete(doc.key)
      await this.deps.lock.release(doc.key, generation)
    }
  }

  /** a failed upload/commit: the machine decides the state (never "failed" on a lost answer) */
  private async failCommit(doc: QueueDoc, error: unknown, now: number): Promise<void> {
    const code = error instanceof UniworkDocError ? error.code : 'server_error'
    await this.apply(doc, { type: 'commitFailed', error: code }, now)
  }

  /**
   * Apply one event: run the machine, persist the record, publish it and
   * perform the machine's effects. A store that refuses the write leaves the
   * record where it was, so nothing downstream acts on a lost state.
   */
  private async apply(doc: QueueDoc, event: QueueEvent, now: number): Promise<TransitionResult> {
    const context: QueueContext = {
      now,
      limits: this.limits,
      random: this.random,
      pausedUser: await this.userPaused(),
    }
    const result = transition(doc.record, event, context)
    if (!result.record) {
      doc.record = { ...doc.record, updatedAt: new Date(now).toISOString() }
      this.deps.publish(doc.record)
      return { record: doc.record, effects: result.effects }
    }
    const access = await this.deps.intents()
    if (access.kind === 'ok') {
      const written = await access.intents.put(doc.key, result.record, doc.payload)
      if (written.kind !== 'ok') {
        this.deps.publish(doc.record)
        return { record: doc.record, effects: [] }
      }
    }
    doc.record = result.record
    this.deps.publish(doc.record)
    return result
  }

  /** the committed snapshot generation: delete exactly it, leave an N+1 dirty */
  private async finishCleanup(doc: QueueDoc): Promise<void> {
    const access = await this.deps.intents()
    if (access.kind === 'ok') await access.intents.delete(doc.key)
    this.otherWindow.delete(doc.key)
  }

  /** a cancelled/superseded intent clears its stored record */
  private async forget(doc: QueueDoc): Promise<void> {
    const access = await this.deps.intents()
    if (access.kind === 'ok') await access.intents.delete(doc.key)
    this.otherWindow.delete(doc.key)
  }

  /**
   * The org's verdict for one pass: a never-read capability allows the write, a
   * known-off one parks the lane, and a stale read past its TTL (the server
   * could not be reached) is `offline`, not an admin refusal.
   */
  private async readCapability(orgId: string): Promise<LaneVerdict> {
    if (!orgId) return 'ok'
    let read: QueueCapabilityRead
    try {
      read = await this.deps.capability.get(orgId)
    } catch {
      // a capability read that threw is a transient network failure
      return 'offline'
    }
    if (read.kind === 'session_expired') return 'session_expired'
    if (read.source === 'default') return 'ok'
    if (read.capabilities.sync_write) return 'ok'
    return read.source === 'stale' ? 'offline' : 'sync_write_off'
  }

  private async userPaused(): Promise<boolean> {
    if (!this.deps.pause) return false
    try {
      return await this.deps.pause.isPaused()
    } catch {
      return false
    }
  }

  /** beat the document lease every heartbeatMs while the lock is held */
  private startHeartbeat(key: string, generation: number): () => void {
    const timer = setInterval(() => {
      void this.deps.lock.heartbeat(key, generation).then((held) => {
        if (!held) this.otherWindow.add(key)
      })
    }, this.limits.heartbeatMs)
    ;(timer as { unref?: () => void }).unref?.()
    return () => clearInterval(timer)
  }
}

/** the minted identity as the machine's `save` input */
function toNewIntent(intent: MintedIntent): NewIntentInput {
  return {
    intentId: intent.intentId,
    idempotencyKey: intent.idempotencyKey,
    documentId: intent.documentId,
    orgId: intent.orgId,
    workspaceId: intent.workspaceId,
    baseRevision: intent.baseRevision,
    baseVersion: intent.baseVersion,
    checksum: intent.checksum,
    length: intent.length,
  }
}
