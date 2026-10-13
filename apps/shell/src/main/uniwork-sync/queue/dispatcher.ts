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
import {
  nextIntentGeneration,
  parseStoredIntent,
  type IntentRecordV2,
  type PendingIntentRecord,
  type QueueState,
} from './record'

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
  }): Promise<{
    documentId: string
    versionId: string
    version: number
    revision: string
    checksumSha256: string | null
  }>
  lookupCommit(input: { documentId: string; idempotencyKey: string }): Promise<CommitLookup>
}

/** the record exactly as a store holds it: a v1 record stays v1 */
export interface StoredIntentValue {
  intent: IntentRecordV2 | PendingIntentRecord
  payload: Uint8Array
}

/** what the queue needs to persist one record (the G5-04 intent store, v2 path) */
export interface QueueIntents {
  read(
    documentKey: string,
    facts: { orgId: string; workspaceId: string; baseVersion: number; length: number },
  ): Promise<{ intent: IntentRecordV2; payload: Uint8Array } | null>
  put(documentKey: string, intent: IntentRecordV2, payload: Uint8Array): Promise<{ kind: string }>
  delete(documentKey: string): Promise<void>
  /**
   * The record exactly as stored (a v1 record stays v1), when the store can
   * serve it. `mint` reads it to age the snapshot generation over an older
   * record; a store that cannot answer mints generation 1.
   */
  get?(documentKey: string): Promise<StoredIntentValue | null>
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
  /**
   * Whether this session may still send for this document (signed in, still
   * the account that owns the binding). Checked right before the upload and
   * right before the commit: false stops the pass with no request and no state
   * of its own, so an account switch mid-upload never commits the copy.
   */
  canCommit?(doc: QueueDoc): boolean
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
  /** the intent-store key of the document, when known: `mint` ages the
   *  snapshot generation over the record the store already holds under it */
  key?: string
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
    const context = await this.context(now)
    const verdict = await this.readCapability(intent.orgId)
    if (verdict === 'sync_write_off') context.syncWrite = false
    if (verdict === 'offline') context.online = false
    const result = transition(null, { type: 'save', intent: toNewIntent(intent) }, context)
    if (!result.record) throw new Error('the queue machine refused the save')
    // a document whose store still holds a record (superseded/committed/older)
    // mints one past that record's generation, so its own cleanup can tell a
    // newer snapshot (N+1 minted meanwhile) apart
    return { ...result.record, generation: await this.mintedGeneration(intent) }
  }

  /**
   * Persist a freshly minted record and publish it (the Ctrl/Cmd+S hand-off).
   * The org's lane verdict decides the record's first state: offline parks it
   * `paused_offline`, a known-off `sync_write` parks it `paused_admin`, the
   * user's durable pause parks it `paused_user`, otherwise it is `queued`.
   */
  async enqueue(doc: QueueDoc): Promise<QueueState> {
    const access = await this.deps.intents()
    if (access.kind !== 'ok') {
      this.deps.publish(doc.record)
      return doc.record.state
    }
    const verdict = await this.readCapability(doc.orgId)
    const context: QueueContext = {
      now: this.deps.clock(),
      limits: this.limits,
      random: this.random,
      pausedUser: await this.userPaused(),
    }
    if (verdict === 'sync_write_off') context.syncWrite = false
    if (verdict === 'offline') context.online = false
    const created = transition(null, { type: 'save', intent: toNewIntent(doc.record) }, context)
    if (created.record) {
      // the caller's record carries the minted generation (a fresh transition
      // always starts at 1; `mint` ages it over an older stored record)
      doc.record = { ...created.record, generation: doc.record.generation }
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
    // a store that cannot open right now (a locked keychain) freezes the whole
    // queue: no state may move without being persisted
    if ((await this.deps.intents()).kind !== 'ok') {
      for (const doc of docs) {
        this.deps.publish(doc.record)
        outcomes.set(doc.key, doc.record.state)
      }
      return { dispatched: 0, parked: docs.length, outcomes }
    }
    const lanes = new Map<string, QueueDoc[]>()
    for (const doc of docs) {
      const lane = lanes.get(doc.orgId) ?? []
      lane.push(doc)
      lanes.set(doc.orgId, lane)
    }
    // one global counter across every org lane of this pass: `concurrency`
    // caps documents in flight for the WHOLE dispatch, never per lane
    let inFlight = 0
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
      for (const doc of lane) {
        if (this.committing.has(doc.key)) {
          outcomes.set(doc.key, doc.record.state)
          continue
        }
        if (this.isInFlightState(doc.record.state)) {
          // a stop left this record mid-flight and THIS dispatcher is not
          // running it: resolve it through the lookup, never a new key or a
          // blind re-upload. It runs under the SAME guards as a full dispatch -
          // the document lock and `canCommit` - so a window without the lock
          // does nothing at all (G5-06 fix-C item 4, d1-1)
          outcomes.set(doc.key, await this.runOne(doc, now))
          dispatched += 1
          continue
        }
        if (!this.isDispatchable(doc.record.state)) {
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
    // the store cannot record an outcome right now: the record stays where it is
    if ((await this.deps.intents()).kind !== 'ok') return doc.record.state
    let lookup: CommitLookup
    try {
      lookup = await this.deps.client.lookupCommit({
        documentId: doc.record.documentId,
        idempotencyKey: doc.record.idempotencyKey,
      })
    } catch (error) {
      const code = error instanceof UniworkDocError ? error.code : 'server_error'
      if (code === 'keystore_locked' || code === 'store_full') return doc.record.state
      const retryAfterMs = error instanceof UniworkDocError ? error.retryAfterMs : undefined
      await this.apply(
        doc,
        { type: 'lookup', error: code, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
        now,
      )
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

  /**
   * Resolve a stored record that is sitting in an in-flight state
   * (validating / uploading / committing) because its writer stopped - a lost
   * lock, `canCommit` false, a crash - and no dispatcher is running it now.
   * `dispatchAll` never picks these states, so without this a save would never
   * settle. The G5-07 lookup with the SAME idempotency key decides: `committed`
   * settles with the receipt, `not_committed` returns to `queued` (the same key
   * is re-sent), `in_flight` stays `reconciling` (retried later), `unknown`
   * becomes `reconciling-stuck`. Never a new key, never a blind re-upload.
   */
  private async settleInFlight(doc: QueueDoc, now: number): Promise<QueueState> {
    if ((await this.deps.intents()).kind !== 'ok') return doc.record.state
    let lookup: CommitLookup
    try {
      lookup = await this.deps.client.lookupCommit({
        documentId: doc.record.documentId,
        idempotencyKey: doc.record.idempotencyKey,
      })
    } catch (error) {
      const code = error instanceof UniworkDocError ? error.code : 'server_error'
      if (code === 'keystore_locked' || code === 'store_full') return doc.record.state
      const retryAfterMs = error instanceof UniworkDocError ? error.retryAfterMs : undefined
      await this.apply(
        doc,
        { type: 'lookup', error: code, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
        now,
      )
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

  /**
   * A connectivity change: coming online moves a `paused_offline` intent back to
   * `queued` (or `paused_user` when the user is still paused); going offline
   * parks a waiting one. A settled intent never moves.
   */
  async setOnline(
    docs: QueueDoc[],
    online: boolean,
    now = this.deps.clock(),
  ): Promise<QueueState[]> {
    const states: QueueState[] = []
    for (const doc of docs) {
      await this.apply(doc, { type: 'online', online }, now)
      states.push(doc.record.state)
    }
    return states
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
   * refused (the cap, the budget, a locked keychain) leaves the STORED intent
   * exactly as it was - nothing is cancelled until the draft is kept.
   */
  async cancel(
    doc: QueueDoc,
    options: { documentClosed: boolean; title?: string; now?: number } = { documentClosed: false },
  ): Promise<QueueState> {
    const now = options.now ?? this.deps.clock()
    // the machine decides before anything is persisted: a cancel that cannot
    // apply never touches the stored record
    if (!(await this.wouldCancel(doc, 'cancel', now))) return doc.record.state
    if (options.documentClosed && this.deps.drafts) {
      const kept = await this.keepDraft(doc, options.title, now)
      if (kept !== 'ok') return this.refuseCancel(doc, kept, now)
    }
    const result = await this.apply(doc, { type: 'cancel' }, now)
    if (result.record?.state !== 'cancelled') return doc.record.state
    await this.forget(doc)
    return 'cancelled'
  }

  /** "Bo lan luu..." on a stuck intent: the snapshot becomes a kept draft */
  async discard(
    doc: QueueDoc,
    options: { title?: string; now?: number } = {},
  ): Promise<QueueState> {
    const now = options.now ?? this.deps.clock()
    if (!(await this.wouldCancel(doc, 'discard', now))) return doc.record.state
    if (this.deps.drafts) {
      const kept = await this.keepDraft(doc, options.title, now)
      if (kept !== 'ok') return this.refuseCancel(doc, kept, now)
    }
    const result = await this.apply(doc, { type: 'discard' }, now)
    if (result.record?.state !== 'cancelled') return doc.record.state
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
    const stored = await this.storedRecord(doc)
    return stored?.state ?? doc.record.state
  }

  // ---- internals -----------------------------------------------------------

  private isDispatchable(state: QueueState): boolean {
    return state === 'queued' || state === 'paused_offline'
  }

  /**
   * A stored record in one of these states was mid-flight when its writer
   * stopped (a lost lock, `canCommit` false, a crash): `dispatchAll` never
   * picks it, so a session that is not running it must resolve it through the
   * G5-07 lookup before it can settle (see `settleInFlight`).
   */
  private isInFlightState(state: QueueState): boolean {
    return state === 'validating' || state === 'uploading' || state === 'committing'
  }

  /** the session/ownership verdict of the front: false stops the pass silently */
  private sessionAllows(doc: QueueDoc): boolean {
    return this.deps.canCommit?.(doc) !== false
  }

  /**
   * Whether the store still holds THIS intent: the same intentId and
   * generation, whatever its state. A cancel, supersede or tombstone another
   * window committed leaves nothing behind for this pass to send.
   */
  private async driving(doc: QueueDoc): Promise<boolean> {
    const stored = await this.storedRecord(doc)
    return (
      stored !== null &&
      stored.intentId === doc.record.intentId &&
      stored.generation === doc.record.generation
    )
  }

  /**
   * One document through the queue. A record that is dispatchable runs
   * validate -> upload -> lock check -> commit; a record left mid-flight at rest
   * (validating/uploading/committing) is settled by ONE lookup instead. Both
   * paths hold the document lock and honour `canCommit`, so a window that does
   * not own the document never writes the shared record or sends a request.
   */
  private async runOne(doc: QueueDoc, now: number): Promise<QueueState> {
    const lock = await this.deps.lock.acquire(doc.key)
    if (lock.kind === 'other_window') {
      // another window edits this document: this one is read-only. It writes
      // NOTHING to the shared record (no transition, no park) - the record is
      // left for the holder; the window only pushes its own status.
      this.otherWindow.add(doc.key)
      this.publishOtherWindow(doc)
      return doc.record.state
    }
    this.otherWindow.delete(doc.key)
    // a record left mid-flight at rest: settle it through the lookup below. It
    // skips the dispatchable/driving gates (its state is not dispatchable) but
    // still holds the lock and passes `canCommit` first (G506-be-d1-1).
    const inFlight = this.isInFlightState(doc.record.state)
    // the record may have been settled while this pass waited for the lock: a
    // cancel, supersede or tombstone that won must leave exactly one outcome,
    // and a record the store no longer holds (or holds for another intent) is
    // not this pass's to send
    if (!inFlight && !this.isDispatchable(doc.record.state)) return doc.record.state
    if (!inFlight && !(await this.driving(doc))) return doc.record.state
    const generation = lock.generation
    const stopBeat = this.startHeartbeat(doc.key, generation)
    this.committing.add(doc.key)
    try {
      // the session must still own this document before a byte moves (or before
      // a settle lookup): false stops the pass with no request and no write
      if (!this.sessionAllows(doc)) return doc.record.state
      // a stop left this record mid-flight: exactly one lookup with the SAME
      // key, never a new key and never a blind re-upload (G5-06 fix-C item 4)
      if (inFlight) return await this.settleInFlight(doc, now)
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
      // the capability can flip off mid-upload: while the record is still
      // `uploading` it parks `paused_admin` and never reaches the commit
      if ((await this.readCapability(doc.orgId)) === 'sync_write_off') {
        await this.apply(doc, { type: 'capability', syncWrite: false }, now)
        return doc.record.state
      }
      // a lost generation (another window took the lock while the bytes moved)
      // stops before the commit, still writing nothing: the record is left for
      // the holder, never parked on a network reason (`paused_offline`)
      if (!(await this.deps.lock.check(doc.key, generation))) {
        this.otherWindow.add(doc.key)
        this.publishOtherWindow(doc)
        return doc.record.state
      }
      // and the session must still own the document right before the commit:
      // an account switch during the upload must not commit this copy
      if (!this.sessionAllows(doc)) return doc.record.state
      // the bytes are staged: the second `uploaded` advances uploading -> committing
      await this.apply(doc, { type: 'uploaded' }, now)
      let receipt: {
        documentId: string
        versionId: string
        version: number
        revision: string
        checksumSha256: string | null
      }
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
    const retryAfterMs = error instanceof UniworkDocError ? error.retryAfterMs : undefined
    await this.apply(
      doc,
      {
        type: 'commitFailed',
        error: code,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      },
      now,
    )
  }

  /**
   * A read-only window's own status: `blocked` with `other_window`, so the
   * chip reads the window lock (never `paused_offline`, which means the
   * network). A status push only - the shared record is never written here.
   */
  private publishOtherWindow(doc: QueueDoc): void {
    this.deps.publish({ ...doc.record, state: 'blocked', lastError: 'other_window' })
  }

  /** the machine context of one transition (the account's pause flag included) */
  private async context(now: number): Promise<QueueContext> {
    return {
      now,
      limits: this.limits,
      random: this.random,
      pausedUser: await this.userPaused(),
    }
  }

  /**
   * Whether a cancel/discard event would move this record, decided by the pure
   * machine BEFORE anything is persisted: a refused kept draft must leave the
   * stored record exactly as it was.
   */
  private async wouldCancel(
    doc: QueueDoc,
    event: 'cancel' | 'discard',
    now: number,
  ): Promise<boolean> {
    const result = transition(doc.record, { type: event }, await this.context(now))
    return result.record?.state === 'cancelled'
  }

  /** the snapshot of a cancelled intent, kept as a draft the user can restore */
  private async keepDraft(
    doc: QueueDoc,
    title: string | undefined,
    now: number,
  ): Promise<'ok' | 'drafts_full' | 'store_full' | 'keystore_locked'> {
    return this.deps.drafts!.keep(doc.key, doc.payload, {
      id: this.uuid(),
      createdAt: new Date(now).toISOString(),
      ...(title ? { title } : {}),
    })
  }

  /**
   * A refused cancel/discard: the stored record does not move (the intent
   * stays exactly as it was, so a restart still has it); this window shows the
   * refusal and its reason.
   */
  private refuseCancel(
    doc: QueueDoc,
    reason: 'drafts_full' | 'store_full' | 'keystore_locked',
    now: number,
  ): QueueState {
    doc.record = {
      ...doc.record,
      state: 'failed',
      lastError: reason,
      updatedAt: new Date(now).toISOString(),
    }
    this.deps.publish(doc.record)
    return doc.record.state
  }

  /** the binding facts a stored record is read (and a v1 record upgraded) with */
  private facts(doc: QueueDoc): {
    orgId: string
    workspaceId: string
    baseVersion: number
    length: number
  } {
    return {
      orgId: doc.orgId,
      workspaceId: doc.workspaceId,
      baseVersion: doc.baseVersion,
      length: doc.record.length,
    }
  }

  /** the record as stored under this document key, or null when there is none */
  private async storedRecord(doc: QueueDoc): Promise<IntentRecordV2 | null> {
    const access = await this.deps.intents()
    if (access.kind !== 'ok') return null
    const stored = await access.intents.read(doc.key, this.facts(doc))
    return stored?.intent ?? null
  }

  /**
   * The generation a freshly minted intent carries: one past the record the
   * store still holds under the document key (v2 only - a v1 record's upgrade
   * stays 1), or 1 over an empty store.
   */
  private async mintedGeneration(intent: MintedIntent): Promise<number> {
    if (!intent.key) return 1
    const access = await this.deps.intents()
    if (access.kind !== 'ok' || !access.intents.get) return 1
    const raw = await access.intents.get(intent.key)
    return nextIntentGeneration(raw ? parseStoredIntent(raw.intent) : null)
  }

  /**
   * Apply one event: run the machine, persist the record, publish it and
   * perform the machine's effects. A store that refuses the write leaves the
   * record where it was, so nothing downstream acts on a lost state; a stored
   * record that is a NEWER intent (N+1 minted meanwhile) is never clobbered.
   */
  private async apply(doc: QueueDoc, event: QueueEvent, now: number): Promise<TransitionResult> {
    const context = await this.context(now)
    const result = transition(doc.record, event, context)
    if (!result.record) {
      doc.record = { ...doc.record, updatedAt: new Date(now).toISOString() }
      this.deps.publish(doc.record)
      return { record: doc.record, effects: result.effects }
    }
    const access = await this.deps.intents()
    if (access.kind !== 'ok') {
      // the store cannot record the change: the record does not move
      this.deps.publish(doc.record)
      return { record: doc.record, effects: [] }
    }
    const stored = await access.intents.read(doc.key, this.facts(doc))
    if (
      stored &&
      (stored.intent.intentId !== doc.record.intentId ||
        stored.intent.generation !== doc.record.generation)
    ) {
      // a newer intent owns this document now: this generation writes nothing
      this.deps.publish(doc.record)
      return { record: doc.record, effects: [] }
    }
    const written = await access.intents.put(doc.key, result.record, doc.payload)
    if (written.kind !== 'ok') {
      this.deps.publish(doc.record)
      return { record: doc.record, effects: [] }
    }
    doc.record = result.record
    this.deps.publish(doc.record)
    return result
  }

  /**
   * The committed snapshot generation: delete exactly it. The stored record is
   * compared with the committed one by intentId AND generation first - a newer
   * record minted while this one committed (N+1) is left untouched for its own
   * dispatch.
   */
  private async finishCleanup(doc: QueueDoc): Promise<void> {
    const access = await this.deps.intents()
    if (access.kind !== 'ok') {
      this.otherWindow.delete(doc.key)
      return
    }
    const stored = await access.intents.read(doc.key, this.facts(doc))
    if (
      stored &&
      stored.intent.intentId === doc.record.intentId &&
      stored.intent.generation === doc.record.generation
    ) {
      await access.intents.delete(doc.key)
    }
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
