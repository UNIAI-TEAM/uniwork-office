import { randomUUID } from 'node:crypto'
import type { CommitLookup } from '../../uniwork-docs/parse'
import { UniworkDocError } from '../../uniwork-docs/errors'
import type { UniworkDocEditLock } from '../../../shared/home-api'
import {
  DEFAULT_DOCUMENT_LIMITS,
  type DocumentLimits,
  type DocumentLimitsCache,
} from '../../uniwork-docs/limits'
import type { SavedUploadSession } from '../../uniwork-docs/upload-session'
import type { LegacyConversion } from '../../uniwork-docs/legacy-cloud'
import {
  abortVersionUploadSession,
  uploadVersionBytes,
  type DocumentUploadSessionClient,
} from '../version-upload'
import type { DocLock } from '../doc-lock'
import { QUEUE_LIMITS, type QueueLimits } from './limits'
import {
  transition,
  type BlockedReason,
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
import { traceQueueTransition } from '../test-hooks/trace'

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
    /** EL-1(b): the held lock of this path; omitted when none */
    editLockId?: string
    /** UNI-2212: the staged OOXML converts the document's legacy live version; omitted otherwise */
    conversion?: LegacyConversion
  }): Promise<{
    documentId: string
    versionId: string
    version: number
    revision: string
    checksumSha256: string | null
  }>
  lookupCommit(input: { documentId: string; idempotencyKey: string }): Promise<CommitLookup>
  /**
   * BIGUP-A1: the upload-session routes a version payload above the chunked
   * threshold uses; absent = every payload uses the single-request `upload`.
   */
  uploadSession?: DocumentUploadSessionClient
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

/**
 * The verdict plus whether a real answer was read this pass: a never-read or
 * stale capability still allows a write, but only a fresh answer proves the
 * session, the org and the member are all live right now - the proof a blocked
 * intent needs before it may go back to the queue.
 */
interface LaneRead {
  verdict: LaneVerdict
  fresh: boolean
}

export interface QueueDispatcherDeps {
  /** the queue's intent store, or why it cannot be reached right now */
  intents(): Promise<
    { kind: 'ok'; intents: QueueIntents } | { kind: 'keystore_locked' } | { kind: 'unavailable' }
  >
  client: QueueClient
  capability: {
    /** `force` asks the cache for a real read: a lift never acts on a cached answer */
    get(orgId: string, options?: { force?: boolean }): Promise<QueueCapabilityRead>
  }
  lock: DocLock
  /** the per-account "pause sending" flag (defaults to "not paused") */
  pause?: QueuePause
  /** the kept-draft store (defaults to a no-op: no draft is ever kept) */
  drafts?: QueueDrafts
  clock(): number
  random?(): number
  limits?: QueueLimits
  /**
   * BIGUP-A1: the deployment's document limits (`chunked_upload_threshold_bytes`);
   * absent = `DEFAULT_DOCUMENT_LIMITS` (no chunked threshold).
   */
  documentLimits?: DocumentLimitsCache | (() => DocumentLimits | Promise<DocumentLimits>)
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
  /**
   * EL-1(b): Q2 — await the path's lock session before the first queued commit
   * when it is 'unreachable'. 'park' = 423, treat as edit_locked (no commit).
   */
  prepareEditLock?(path: string): Promise<'held' | 'park' | 'proceed'>
  /** EL-1(b): current lock id of a held path (outgoing commit body) */
  editLockId?(path: string): string | null
  /**
   * UNI-2212: the conversion the commit of this path's copy declares (its legacy live version is
   * replaced by the converted OOXML), or null for an ordinary commit. Read from the binding at
   * commit time, so a replayed intent follows the copy's current state, never a stale record.
   */
  conversionFor?(path: string): LegacyConversion | null
  /** EL-1(b) B8: holder summary for a synthesised park 423 */
  editLockHolder?(path: string): UniworkDocEditLock | null
  /** EL-1(b): a 423 on commit while we held — session becomes 'lost' */
  onCommitEditLocked?(path: string, error: UniworkDocError): void
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
  /** in-flight version-upload abort controllers, keyed by document key */
  private readonly uploadAborts = new Map<string, AbortController>()
  /** R2-BE-04: in-flight version-upload session ids in memory, independent of store persistence */
  private readonly uploadLiveSessions = new Map<string, string>()

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
   * A32 (UNI-1362): whether another window holds this document's lease right
   * now, read from the durable lock file rather than this window's in-memory
   * set (which only a dispatch clears). A lock whose state cannot be read
   * answers true, so a caller revalidating its read-only status keeps it instead
   * of clearing it on a guess.
   */
  async holdsOtherWindow(key: string): Promise<boolean> {
    try {
      return await this.deps.lock.isHeld(key)
    } catch {
      return true
    }
  }

  /**
   * Mint the v2 record of one Ctrl/Cmd+S: its state is the lane's verdict
   * (offline wins over a known-off capability, a user pause parks it, a
   * never-read capability allows the write).
   */
  async mint(intent: MintedIntent): Promise<IntentRecordV2> {
    const now = this.deps.clock()
    const context = await this.context(now)
    const { verdict } = await this.readCapability(intent.orgId)
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
    const { verdict } = await this.readCapability(doc.orgId)
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
    traceQueueTransition(null, doc.record, { type: 'save' }, context.now)
    return doc.record.state
  }

  /**
   * "Luu lai" on a failed intent: the old intent is superseded and a new one
   * minted from the same snapshot, in ONE store write. The document key holds a
   * single record, so writing the new intent over it is the supersede; nothing
   * is written until the machine has agreed to supersede the old intent, and a
   * refused write (the budget, a locked keychain) leaves the old intent exactly
   * as it was - the queued save is never lost. Only after the write landed are
   * the old intent's `cancelled` (reason `superseded`) and the new intent's
   * state published. The caller's `doc` is not touched.
   */
  async replace(
    doc: QueueDoc,
    intent: MintedIntent,
    now = this.deps.clock(),
  ): Promise<
    | { kind: 'ok'; doc: QueueDoc }
    | { kind: 'busy' }
    | { kind: 'refused'; reason: 'store_full' | 'keystore_locked' | 'unavailable' }
  > {
    const access = await this.deps.intents()
    if (access.kind !== 'ok') {
      return {
        kind: 'refused',
        reason: access.kind === 'keystore_locked' ? 'keystore_locked' : 'unavailable',
      }
    }
    const priorSession = doc.record.uploadSession
    const superseded = transition(doc.record, { type: 'supersede' }, await this.context(now)).record
    if (superseded?.state !== 'cancelled') return { kind: 'busy' }
    const minted = await this.mint({ ...intent, key: doc.key })
    const written = await access.intents.put(doc.key, minted, doc.payload)
    if (written.kind !== 'ok') {
      return {
        kind: 'refused',
        reason:
          written.kind === 'store_full'
            ? 'store_full'
            : written.kind === 'keystore_locked'
              ? 'keystore_locked'
              : 'unavailable',
      }
    }
    await this.releaseUploadSession(doc.key, priorSession)
    this.otherWindow.delete(doc.key)
    this.deps.publish(superseded)
    this.deps.publish(minted)
    return { kind: 'ok', doc: { ...doc, record: minted } }
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
      // a lane with an intent the capability answer could lift reads it for
      // real: a cached answer may predate the refusal this pass has to undo
      const lifting = lane.some((doc) => {
        const error = doc.record.state === 'blocked' ? doc.record.lastError : undefined
        return (
          error === 'session_expired' ||
          error === 'organization_suspended' ||
          error === 'member_deactivated'
        )
      })
      const { verdict, fresh } = await this.readCapability(orgId, lifting)
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
      // the lane answered: a blocked intent whose condition is exactly that -
      // the session signs in again, the org or the member is active again -
      // goes back to the queue BEFORE this pass picks documents up, so the same
      // intent commits here, under the SAME capability read that lifted it
      await this.liftCapabilityBlocks(lane, fresh, now)
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
      // R5: the automatic pass obeys the same guards as a full dispatch - the
      // document lock and `canCommit` - BEFORE its tick transition and its
      // lookup. A window that does not own the document (or whose session no
      // longer commits) sends no GET and writes nothing to the shared record:
      // the holder ages the record and performs the lookup itself.
      const lock = await this.deps.lock.acquire(doc.key)
      if (lock.kind === 'other_window') {
        this.otherWindow.add(doc.key)
        this.publishOtherWindow(doc)
        outcomes.set(doc.key, doc.record.state)
        continue
      }
      this.otherWindow.delete(doc.key)
      const generation = lock.generation
      try {
        if (!this.sessionAllows(doc)) {
          outcomes.set(doc.key, doc.record.state)
          continue
        }
        const result = await this.apply(doc, { type: 'tick', now }, now)
        outcomes.set(doc.key, doc.record.state)
        if (result.effects.some((effect) => effect.kind === 'lookup')) {
          await this.reconcile(doc, now)
          outcomes.set(doc.key, doc.record.state)
          dispatched += 1
        }
      } finally {
        await this.deps.lock.release(doc.key, generation)
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
        error,
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
        error,
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
    const priorSession = doc.record.uploadSession
    const result = await this.apply(doc, { type: 'cancel' }, now)
    if (result.record?.state !== 'cancelled') return doc.record.state
    await this.releaseUploadSession(doc.key, priorSession)
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
    const priorSession = doc.record.uploadSession
    const result = await this.apply(doc, { type: 'discard' }, now)
    if (result.record?.state !== 'cancelled') return doc.record.state
    await this.releaseUploadSession(doc.key, priorSession)
    await this.forget(doc)
    return 'cancelled'
  }

  /** Overwrite / Reload / "Luu lai": the old intent is superseded BEFORE a new one */
  async supersede(doc: QueueDoc, now = this.deps.clock()): Promise<QueueState> {
    const { state, release } = await this.supersedeDeferRelease(doc, now)
    await release()
    return state
  }

  /**
   * Same supersession, but the upload-session DELETE (network) is handed back
   * instead of awaited: a caller that validated its destructive stretch (a
   * conflict action) must not wait on the network inside it. The local part of
   * the release (aborting this document's in-flight part PUTs) happens now, so
   * the returned closure never touches a later Save's controller.
   */
  async supersedeDeferRelease(
    doc: QueueDoc,
    now = this.deps.clock(),
  ): Promise<{ state: QueueState; release: () => Promise<void> }> {
    const priorSession = doc.record.uploadSession
    const result = await this.apply(doc, { type: 'supersede' }, now)
    const release =
      result.record?.state === 'cancelled'
        ? this.takeUploadRelease(doc.key, priorSession)
        : async () => {}
    return { state: result.record?.state ?? doc.record.state, release }
  }

  /**
   * "Bo nhap..." on a BLOCKED intent (access or document lost): the user drops
   * the snapshot. A block never does this by itself; any other state refuses
   * and leaves the stored record untouched.
   */
  async abandonBlocked(doc: QueueDoc, now = this.deps.clock()): Promise<QueueState> {
    const priorSession = doc.record.uploadSession
    const result = await this.apply(doc, { type: 'abandon' }, now)
    if (result.record?.state !== 'cancelled') return doc.record.state
    await this.releaseUploadSession(doc.key, priorSession)
    await this.forget(doc)
    return 'cancelled'
  }

  /**
   * A blocking condition lifted (see the service's triggers): the SAME intent -
   * snapshot, generation and base untouched - goes back to the waiting queue and
   * commits through the normal path. Only a record blocked on exactly `reason`
   * moves, so a lift of one condition never wakes an intent another condition
   * parked, and a second lift of the same one is a no-op. A record whose state
   * is not `blocked`, or whose block nobody named, is left exactly as it was.
   */
  async unblock(
    docs: QueueDoc[],
    reason: BlockedReason,
    now = this.deps.clock(),
  ): Promise<QueueState[]> {
    const states: QueueState[] = []
    for (const doc of docs) {
      if (doc.record.state !== 'blocked' || doc.record.lastError !== reason) {
        states.push(doc.record.state)
        continue
      }
      const result = await this.apply(doc, { type: 'unblock', reason }, now)
      states.push(result.record?.state ?? doc.record.state)
    }
    return states
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
   * stopped (a lost lock, `canCommit` false, a crash): `dispatchAll` never picks
   * it, so a session that is not running it must resolve it first - `committing`
   * through the G5-07 lookup (`settleInFlight`), `validating`/`uploading` by a
   * local requeue and re-send (AC-4; see `runOne`).
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
   * validate -> upload -> lock check -> commit. A record left mid-flight at rest
   * because its writer stopped (a lost lock, `canCommit` false, a crash) is
   * resolved first: `committing` at rest settles through ONE lookup (the commit
   * POST may have landed), while `validating`/`uploading` at rest provably never
   * sent the commit, so it goes back to `queued` with the SAME key and is
   * re-sent here. Every path holds the document lock and honours `canCommit`, so
   * a window that does not own the document never writes the shared record or
   * sends a request.
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
    // a record left mid-flight at rest: resolve it below. It skips the
    // dispatchable/driving gates (its state is not dispatchable) but still holds
    // the lock and passes `canCommit` first (G506-be-d1-1).
    const inFlight = this.isInFlightState(doc.record.state)
    const commitInFlight = doc.record.state === 'committing'
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
      // `committing` at rest: the commit POST may have landed, so exactly one
      // lookup with the SAME key decides - never a new key, never a blind
      // re-upload (G5-06 fix-C item 4)
      if (commitInFlight) return await this.settleInFlight(doc, now)
      if (inFlight) {
        // `validating`/`uploading` at rest: the commit POST was never sent, so
        // the server never received this key and a lookup would answer 410
        // commit_intent_unknown -> reconciling-stuck for a save it never saw
        // (AC-4). The record is provably not committed: requeue it with the SAME
        // key and re-send it here, under this same lock and canCommit guard.
        await this.apply(doc, { type: 'lookup', outcome: 'not_committed' }, now)
        if (doc.record.state !== 'queued') return doc.record.state
      }
      // validation passed: the first `uploaded` advances validating -> uploading
      await this.apply(doc, { type: 'dispatch' }, now)
      await this.apply(doc, { type: 'uploaded' }, now)
      let upload: { uploadId: string; checksumSha256: string }
      const controller = new AbortController()
      this.uploadAborts.set(doc.key, controller)
      try {
        upload = await uploadVersionBytes(this.deps.client, {
          documentId: doc.record.documentId,
          filename: doc.filename,
          format: doc.format,
          bytes: doc.payload,
          idempotencyKey: doc.record.idempotencyKey,
          attempt: doc.record.attempt,
          limits: await this.resolveDocumentLimits(),
          ...(doc.record.uploadSession ? { resume: doc.record.uploadSession } : {}),
          signal: controller.signal,
          onSessionState: (state) => this.persistUploadSession(doc, state, now),
        })
      } catch (error) {
        if (controller.signal.aborted) return doc.record.state
        await this.failCommit(doc, error, now)
        return doc.record.state
      } finally {
        if (this.uploadAborts.get(doc.key) === controller) {
          this.uploadAborts.delete(doc.key)
          this.uploadLiveSessions.delete(doc.key)
        }
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
      if ((await this.readCapability(doc.orgId)).verdict === 'sync_write_off') {
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
      // EL-1(b) Q2: an unreachable open acquires before the first queued commit
      const prepared = (await this.deps.prepareEditLock?.(doc.path)) ?? 'proceed'
      if (prepared === 'park') {
        const holder = this.deps.editLockHolder?.(doc.path)
        await this.failCommit(
          doc,
          new UniworkDocError('edit_locked', {
            status: 423,
            serverCode: 'document_locked',
            ...(holder ? { editLock: holder } : {}),
          }),
          now,
        )
        return doc.record.state
      }
      const editLockId = this.deps.editLockId?.(doc.path) ?? null
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
        const conversion = this.deps.conversionFor?.(doc.path) ?? null
        receipt = await this.deps.client.commit({
          documentId: doc.record.documentId,
          uploadId: upload.uploadId,
          baseRevision: doc.record.baseRevision,
          idempotencyKey: doc.record.idempotencyKey,
          ...(editLockId ? { editLockId } : {}),
          ...(conversion ? { conversion } : {}),
        })
      } catch (error) {
        if (error instanceof UniworkDocError && error.code === 'edit_locked' && editLockId) {
          this.deps.onCommitEditLocked?.(doc.path, error)
        }
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
    // UNI-1918 (B69-lite): the server refused the COMMIT because the staged
    // upload's claim expired. That is not "the upload is gone": the commit
    // POST may have been resolved before the claim lapsed, so the intent is
    // kept and exactly ONE lookup of the SAME commit key decides
    // (committed → settle, not_committed → attempt+1 queued, in_flight →
    // reconciling, unknown → reconciling-stuck). Never a dropped intent, never
    // a new key minted behind the user's back.
    if (
      error instanceof UniworkDocError &&
      error.serverCode === 'document_upload_invalid' &&
      error.reason === 'file_claim_expired'
    ) {
      // R7: the claim expired, so the record must DURABLY reconcile before the
      // lookup (the machine's own `commitFailed` / `ticket_expired` enters
      // `reconciling` with `reconcileSince`). A transient lookup failure then
      // leaves an aging `reconciling` row the tick can age, never `committing`.
      await this.apply(doc, { type: 'commitFailed', error: 'ticket_expired' }, now)
      await this.settleInFlight(doc, now)
      return
    }
    const code = error instanceof UniworkDocError ? error.code : 'server_error'
    const retryAfterMs = error instanceof UniworkDocError ? error.retryAfterMs : undefined
    const maxBytes = error instanceof UniworkDocError ? error.maxBytes : undefined
    await this.apply(
      doc,
      {
        type: 'commitFailed',
        error: code,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        ...(maxBytes === undefined ? {} : { maxBytes }),
      },
      now,
      error,
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
  private async apply(
    doc: QueueDoc,
    event: QueueEvent,
    now: number,
    cause?: unknown,
  ): Promise<TransitionResult> {
    const from = doc.record.state
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
    traceQueueTransition(from, result.record, event, now, cause)
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

  private async resolveDocumentLimits(): Promise<DocumentLimits> {
    if (!this.deps.documentLimits) return DEFAULT_DOCUMENT_LIMITS
    try {
      if (typeof this.deps.documentLimits === 'function') {
        return await this.deps.documentLimits()
      }
      return await this.deps.documentLimits.get()
    } catch {
      return DEFAULT_DOCUMENT_LIMITS
    }
  }

  /**
   * BIGUP-A1: persist the session state (`sessionId` and `completedParts`) onto
   * the stored `IntentRecordV2` after session creation and each finished part,
   * under the same `intentId` + `generation` guard as `apply`.
   */
  private async persistUploadSession(
    doc: QueueDoc,
    session: SavedUploadSession | undefined,
    now: number,
  ): Promise<void> {
    if (session) {
      this.uploadLiveSessions.set(doc.key, session.sessionId)
      doc.record = {
        ...doc.record,
        uploadSession: session,
        updatedAt: new Date(now).toISOString(),
      }
    } else {
      this.uploadLiveSessions.delete(doc.key)
      const cleared: IntentRecordV2 = {
        ...doc.record,
        updatedAt: new Date(now).toISOString(),
      }
      delete cleared.uploadSession
      doc.record = cleared
    }
    const access = await this.deps.intents()
    if (access.kind !== 'ok') return
    const stored = await access.intents.read(doc.key, this.facts(doc))
    if (
      !stored ||
      stored.intent.intentId !== doc.record.intentId ||
      stored.intent.generation !== doc.record.generation
    ) {
      return
    }
    const latest = doc.record.uploadSession ?? session
    const next: IntentRecordV2 = {
      ...stored.intent,
      updatedAt: new Date(now).toISOString(),
    }
    if (latest) next.uploadSession = latest
    else delete next.uploadSession
    const written = await access.intents.put(doc.key, next, doc.payload)
    if (written.kind === 'ok') {
      doc.record = latest ? { ...next, uploadSession: doc.record.uploadSession ?? latest } : next
    }
  }

  /** BIGUP-A1: abort any in-flight part PUTs for `docKey` and DELETE its upload session */
  private async releaseUploadSession(
    docKey: string,
    session: SavedUploadSession | undefined,
  ): Promise<void> {
    await this.takeUploadRelease(docKey, session)()
  }

  /**
   * The local half of the release (abort in-flight part PUTs, forget the live
   * session) runs now; the returned closure is the network DELETE alone, bound
   * to the session id captured here.
   */
  private takeUploadRelease(
    docKey: string,
    session: SavedUploadSession | undefined,
  ): () => Promise<void> {
    const controller = this.uploadAborts.get(docKey)
    if (controller) {
      controller.abort()
      this.uploadAborts.delete(docKey)
    }
    const liveSessionId = this.uploadLiveSessions.get(docKey)
    this.uploadLiveSessions.delete(docKey)
    const sessionId = session?.sessionId ?? liveSessionId
    const client = this.deps.client.uploadSession
    if (!sessionId || !client) return async () => {}
    return async () => {
      try {
        await abortVersionUploadSession(client, sessionId)
      } catch (error) {
        console.warn('uniwork sync: the upload session could not be aborted', error)
      }
    }
  }

  /**
   * The lane's capability answered for this queue's own session: the account
   * and deployment the records are bound to are signed in (a 401 answers
   * `session_expired` instead), and a fresh answer also proves the organization
   * and the member are active - the three things a `blocked` intent waits on
   * here. `fresh` is the proof: a never-read or cached answer still allows a
   * write, but a lift on one could dispatch against a session the server has
   * already expired, so it lifts nothing. The same read that lifts is the read
   * the pass then dispatches under.
   */
  private async liftCapabilityBlocks(lane: QueueDoc[], fresh: boolean, now: number): Promise<void> {
    if (!fresh) return
    await this.unblock(lane, 'session_expired', now)
    await this.unblock(lane, 'organization_suspended', now)
    await this.unblock(lane, 'member_deactivated', now)
  }

  /**
   * The org's verdict for one pass: a never-read capability allows the write, a
   * known-off capability parks the lane, and a stale read past its TTL (the
   * server could not be reached) is `offline`, not an admin refusal. `force` is
   * set for a lane that holds an intent one of these answers could lift: a
   * cached answer may predate the refusal, so only a real one counts.
   */
  private async readCapability(orgId: string, force = false): Promise<LaneRead> {
    if (!orgId) return { verdict: 'ok', fresh: false }
    let read: QueueCapabilityRead
    try {
      read = force
        ? await this.deps.capability.get(orgId, { force: true })
        : await this.deps.capability.get(orgId)
    } catch {
      // a capability read that threw is a transient network failure
      return { verdict: 'offline', fresh: false }
    }
    if (read.kind === 'session_expired') return { verdict: 'session_expired', fresh: false }
    if (read.source === 'default') return { verdict: 'ok', fresh: false }
    if (read.capabilities.sync_write) return { verdict: 'ok', fresh: read.source === 'fresh' }
    return { verdict: read.source === 'stale' ? 'offline' : 'sync_write_off', fresh: false }
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
