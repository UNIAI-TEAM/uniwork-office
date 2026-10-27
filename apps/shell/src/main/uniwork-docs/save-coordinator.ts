import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { UniworkDocEditLock, UniworkDocStatus } from '../../shared/home-api'
import type { Binding, BindingStore, BoundDocument } from './binding-store'
import type { UniworkDocsClient } from './client'
import { UniworkDocError, isTerminalRefusal } from './errors'
import { sha256Hex } from './formats'
import { conversionFor, convertedTitle } from './legacy-cloud'
import { DEFAULT_DOCUMENT_LIMITS, type DocumentLimits, type DocumentLimitsCache } from './limits'
import type { CommitLookup, CommitReceipt, DocumentDetail } from './parse'
import type { SavedUploadSession } from './upload-session'
import {
  abortVersionUploadSession,
  uploadVersionBytes,
  type DocumentUploadSessionClient,
} from '../uniwork-sync/version-upload'
import type { IntentBindFacts, IntentRecordV2, IntentStore } from '../uniwork-sync/intent-store'
import {
  isTerminalQueueState,
  nextIntentGeneration,
  parseStoredIntent,
} from '../uniwork-sync/queue/record'
import { transition, type QueueEvent } from '../uniwork-sync/queue/machine'
import type {
  QueueCapabilityRead,
  QueueDispatcher,
  QueueDoc,
  QueueDrafts,
  QueuePause,
} from '../uniwork-sync/queue/dispatcher'
import { QUEUE_LIMITS } from '../uniwork-sync/queue/limits'
import { traceCoordinatorTransition } from '../uniwork-sync/test-hooks/trace'

/**
 * The Ctrl/Cmd+S front of the UniWork save queue (EXPERIENCE - Ctrl/Cmd+S,
 * :206-217) and the G5-04 save pipeline it grew from.
 *
 * One explicit user Save of a bound working copy:
 *
 * - a store that cannot open (locked keychain) refuses with `keystore_locked`,
 *   and a store that refuses the intent write (budget full) with `store_full`:
 *   no intent, no request, no other save path (the G5-04 behaviour, kept);
 * - the decision table decides the intent's first state: no network is
 *   `paused_offline`, a known-off `sync_write` is `paused_admin`, the user's
 *   durable "pause sending" is `paused_user`, a capability that was never read
 *   still writes (a never-read `sync_write` counts as on), and everything else
 *   is `queued`;
 * - the intent (identity, key, base revision, checksum, snapshot generation and
 *   the binding facts org/workspace/baseVersion/length) and its payload are
 *   persisted as a v2 record BEFORE any network call; the binding never carries
 *   one (there is exactly one place a pending intent can be);
 * - an intent already pending is never replaced by a second one: the same
 *   record and key are replayed, and the status carries `pendingNext` while the
 *   working copy has moved past the intent's snapshot (an unsent N+1);
 * - the pipeline then validates, uploads and commits with the SAME
 *   Idempotency-Key; only a commit receipt for this document whose checksum
 *   equals the intent's moves the base;
 * - a refusal that proves nothing committed (403 permission, 404, payload
 *   mismatch, ...) drops the intent; a base conflict (409) keeps it as a durable
 *   `conflict`; a capability kill switch (`office_capability_off`) keeps it and
 *   parks as `paused_admin`; a swept intent is `intent_unknown` (never a new
 *   key, never deleted); a real tombstone is `document_deleted`;
 * - a lost commit answer (timeout / network after the upload) is never called
 *   failed: it reconciles;
 * - the account that started the save must still be the signed-in one when the
 *   commit is sent (an account switch mid-upload never commits);
 * - while saving, another Save returns at once; bytes identical to the base
 *   never touch the network; a conflict refuses every Save until the user
 *   resolves it; a view-only document never reaches the network.
 *
 * The queue engine itself (lanes, lock, backoff, reconcile, cleanup) is
 * `QueueDispatcher`; when one is injected, `save` hands the minted record to it
 * and the dispatcher performs the network steps. W4b wires the dispatcher, the
 * drafts and the pause store; the methods below are the surface it calls.
 */

const IN_FLIGHT_BACKOFF_MS = [250, 1000, 2000] as const
/** the server's answers for a staged upload that no longer resolves */
const UPLOAD_GONE_CODES: ReadonlySet<string> = new Set([
  'document_upload_invalid',
  'upload_missing',
  'upload_checksum_mismatch',
])

const IN_FLIGHT_QUEUE_STATES: ReadonlySet<IntentRecordV2['state']> = new Set([
  'validating',
  'uploading',
  'committing',
  'reconciling',
  'reconciling-stuck',
])

/** a failure the document itself has to settle (did it commit? does it still exist?) */
function needsRecheck(error: unknown): error is UniworkDocError {
  return (
    error instanceof UniworkDocError &&
    (error.code === 'not_found' ||
      error.code === 'deleted' ||
      (error.serverCode !== undefined && UPLOAD_GONE_CODES.has(error.serverCode)))
  )
}

/**
 * R2: the verdict of one inline phase write. `ok` is true only when the store
 * really holds this attempt's own record in `state` afterwards (or the settled
 * record was cleaned up). A store refusal, an interrupted write, or a key a
 * newer generation now owns is `ok: false`, and `state` then reports the state
 * the store really holds (null when nothing is stored at all).
 */
type PhaseWrite =
  | { ok: true; state: IntentRecordV2['state'] | null }
  | {
      ok: false
      refusal: 'store_full' | 'interrupted' | 'owner_lost'
      state: IntentRecordV2['state'] | null
    }

/**
 * R2: the durable record could not be driven to `committing` before the commit
 * POST. Carries why (and the state the store really holds), so the caller keeps
 * the intent and publishes that state instead of committing blind.
 */
class PhaseWriteRefusedError extends UniworkDocError {
  readonly refusal: 'store_full' | 'interrupted' | 'owner_lost'
  readonly durableState: IntentRecordV2['state'] | null

  constructor(
    refusal: 'store_full' | 'interrupted' | 'owner_lost',
    durableState: IntentRecordV2['state'] | null,
  ) {
    super(
      refusal === 'store_full'
        ? 'store_full'
        : refusal === 'interrupted'
          ? 'not_signed_in'
          : 'server_error',
    )
    this.refusal = refusal
    this.durableState = durableState
  }
}

/**
 * B70: a COMMIT-leg failure whose answer the server never gave. It keeps the
 * original code and status - `applyFailure` and the trace read the same
 * verdicts - and exists only so the pipeline can tell a lost commit answer
 * (reconcile) from the same error on the upload leg (today's `offline`).
 */
class CommitAnswerLostError extends UniworkDocError {
  constructor(reason: UniworkDocError) {
    super(reason.code, {
      ...(reason.serverCode === undefined ? {} : { serverCode: reason.serverCode }),
      ...(reason.status === undefined ? {} : { status: reason.status }),
      ...(reason.retryAfterMs === undefined ? {} : { retryAfterMs: reason.retryAfterMs }),
    })
  }
}

/**
 * The intent store of the live session, or why it cannot be reached. A locked
 * store refuses the save with `keystore_locked`; a session without one never
 * saves (the intent is what makes a replay safe).
 */
export type IntentAccess =
  { kind: 'ok'; intents: IntentStore } | { kind: 'keystore_locked' } | { kind: 'unavailable' }

/** the queue engine the front hands a minted record to (see QueueDispatcher) */
export type SaveQueueEngine = Pick<
  QueueDispatcher,
  | 'mint'
  | 'enqueue'
  | 'dispatchAll'
  | 'reconcile'
  | 'recheck'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'discard'
  | 'supersede'
  | 'tombstone'
  | 'isOtherWindow'
  | 'holdsOtherWindow'
> &
  // optional so an engine without it keeps the awaited `supersede` (release included)
  Partial<Pick<QueueDispatcher, 'supersedeDeferRelease'>>

export interface SaveCoordinatorDeps {
  store: BindingStore
  client: Pick<UniworkDocsClient, 'upload' | 'commit' | 'getDocument'> & {
    /** BIGUP-A1: the upload-session routes for a version payload above the chunked threshold */
    uploadSession?: DocumentUploadSessionClient
    /**
     * UNI-1918 (B69-lite): the commit-intent lookup. The inline pipeline runs
     * exactly ONE lookup when the server refuses a staged upload because its
     * claim expired: only that answer (committed / not_committed / in_flight /
     * unknown) decides what happens to the intent. Absent = the refusal keeps
     * today's recheck (a caller without the route never resumes).
     */
    lookupCommit?(input: { documentId: string; idempotencyKey: string }): Promise<CommitLookup>
  }
  isSignedIn(): boolean
  /** the binding belongs to the signed-in account and the active deployment */
  ownsBinding(doc: BoundDocument): boolean
  /** the durable intent store of the live session (see IntentAccess) */
  intents(): Promise<IntentAccess>
  /** status push for every state change */
  publish(status: UniworkDocStatus): void
  /**
   * G5-06u: the user's Ctrl/Cmd+S met a document with a pending save (or a
   * refused one): ask the shell renderer to open the queue popover of `path`.
   */
  requestQueuePopover?(path: string): void
  /**
   * G8-12: a Save of `doc` settled with a commit and the binding now names the
   * server version `versionId` (the comments anchor base). Never called for a
   * failed, conflicted or no-op Save.
   */
  onSaved?(doc: BoundDocument, versionId: string): void
  /**
   * Document size limits cache or getter (`SIZE-F1` §5.2 item 1, defaults to
   * 200 MiB / 90%). A save above `max_bytes` refuses before `intents.put` and
   * publishes `{ state: 'failed', error: 'too_large', sizeBytes, maxBytes,
   * saveTooLargePrompt }`; a save in the warn band publishes `sizeWarn` once
   * per bound document session. The published status is the only signal the
   * shell needs: it is what opens the save-block dialog and the warn chip.
   */
  limits?: DocumentLimitsCache | (() => DocumentLimits | Promise<DocumentLimits>)
  now?(): Date
  uuid?(): string
  sleep?(ms: number): Promise<void>
  readBytes?(path: string): Promise<Uint8Array>
  /** the org capability cache; absent = writes allowed (the G5-04 behaviour) */
  capability?: { get(orgId: string): Promise<QueueCapabilityRead> }
  /** the durable per-account "pause sending" flag */
  pause?: QueuePause
  /** the kept-draft store (a cancelled intent's snapshot) */
  drafts?: QueueDrafts
  /** the queue engine; absent = the legacy inline pipeline runs (see the module doc) */
  dispatcher?: SaveQueueEngine
  /**
   * Whether the queue engine is dispatching `docKey` right now. The dispatcher
   * exposes no public in-flight state, so the service supplies this from the
   * poll pass it drives; the inline pipeline never starts a second writer of a
   * key the queue is already running (G506-be-1).
   */
  dispatcherBusy?(docKey: string): boolean
  /**
   * EL-1(b) Q2: acquire before the first queued commit when the session is
   * 'unreachable'. 'park' = 423 — fail as edit_locked, send no commit.
   */
  prepareEditLock?(path: string): Promise<'held' | 'park' | 'proceed'>
  /** EL-1(b): lock id of a held path, sent as commit `edit_lock_id` */
  editLockId?(path: string): string | null
  /** EL-1(b) B8: holder summary for a synthesised park 423 */
  editLockHolder?(path: string): UniworkDocEditLock | null
  /** EL-1(b): 423 on commit while held — session becomes 'lost' */
  onCommitEditLocked?(path: string, error: UniworkDocError): void
}

/**
 * G5-03a FF: the base (`baseRevision` + `baseChecksum`) a binding rewrite was
 * decided from. `commitState` compares it inside the per-key chain, against
 * the binding as it is at write time, and writes nothing when the document no
 * longer carries it: a guarded reload/restore (or any other base-moving write)
 * that committed after the decision can never be overwritten by state derived
 * from the superseded read.
 */
export interface CommitBaseGuard {
  baseRevision: string
  baseChecksum: string
}

export function toStatus(doc: BoundDocument, pendingNext = false): UniworkDocStatus {
  const b = doc.binding
  return {
    path: doc.path,
    documentId: b.documentId,
    workspaceId: b.workspaceId,
    title: b.title,
    format: b.format,
    access: b.shelved ? 'view' : b.access,
    ...(b.shelved ? { commentsLevel: 'view' } : b.level ? { commentsLevel: b.level } : {}),
    state: b.state,
    ...(b.error ? { error: b.error } : {}),
    ...(b.state === 'edit_locked' && b.editLock ? { editLock: b.editLock } : {}),
    ...(b.sizeBytes !== undefined ? { sizeBytes: b.sizeBytes } : {}),
    ...(b.maxBytes !== undefined ? { maxBytes: b.maxBytes } : {}),
    ...(b.lastSavedAt ? { lastSavedAt: b.lastSavedAt } : {}),
    ...(pendingNext ? { pendingNext } : {}),
  }
}

function withoutError(binding: Binding): Binding {
  const next = { ...binding }
  delete next.error
  delete next.editLock
  delete next.sizeBytes
  delete next.maxBytes
  return next
}

/** the binding facts a v2 intent carries (the upgrade path of a legacy record) */
function factsOf(doc: BoundDocument, length: number): IntentBindFacts {
  return {
    orgId: doc.binding.orgId,
    workspaceId: doc.binding.workspaceId,
    baseVersion: doc.binding.baseVersion,
    length,
  }
}

/** the org's lane verdict, from the capability cache (or "writes allowed" with none) */
async function laneVerdict(
  capability: SaveCoordinatorDeps['capability'],
  orgId: string,
): Promise<'ok' | 'sync_write_off' | 'offline'> {
  if (!capability || !orgId) return 'ok'
  let read: QueueCapabilityRead
  try {
    read = await capability.get(orgId)
  } catch {
    return 'offline'
  }
  if (read.kind === 'session_expired') return 'ok'
  if (read.source === 'default') return 'ok'
  if (read.capabilities.sync_write) return 'ok'
  return read.source === 'stale' ? 'offline' : 'sync_write_off'
}

export class SaveCoordinator {
  private readonly deps: SaveCoordinatorDeps
  private readonly saving = new Set<string>()
  private readonly running = new Map<string, Promise<BoundDocument>>()
  /** paths whose working copy has moved past their pending intent (an unsent N+1) */
  private readonly pendingNext = new Set<string>()
  /**
   * Paths whose last inline attempt ended without committing: the record is
   * dropped (or was never written) and the base is where the attempt found it.
   * That outcome is the only thing telling a settle that FAILED from a first
   * save that has not minted its intent yet - both leave no record and an
   * unmoved base (RBE6u4-01). The next attempt of the path replaces it.
   */
  private readonly uncommittedAttempts = new Set<string>()
  /**
   * Per-document serialization of the binding writes. The inline pipeline and
   * the dispatcher's `publish` both rewrite `binding.json` for the same key;
   * chaining them per key keeps the last state in event order (G506-be-7).
   */
  private readonly bindingChains = new Map<string, Promise<unknown>>()
  /** Document keys that have already emitted a 90% size warning in this bound session. */
  private readonly warnedDocs = new Set<string>()
  /** Active warn-band payload for the currently executing save of `path`. */
  private readonly activeSizeWarns = new Map<string, { sizeBytes: number; maxBytes: number }>()
  /** Paths whose current save just exceeded `maxBytes` and the monotonic sequence id of that prompt. */
  private readonly activeTooLargePrompt = new Map<string, number>()
  private tooLargePromptSeq = 0
  private readonly now: () => Date
  private readonly uuid: () => string
  private readonly sleep: (ms: number) => Promise<void>
  /** in-flight inline version-upload abort controllers, keyed by document key */
  private readonly uploadAborts = new Map<string, AbortController>()
  /** R2-BE-04: in-flight version-upload session ids in memory, independent of store persistence */
  private readonly uploadLiveSessions = new Map<string, string>()
  private readonly readBytes: (path: string) => Promise<Uint8Array>

  constructor(deps: SaveCoordinatorDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
    this.uuid = deps.uuid ?? randomUUID
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.readBytes = deps.readBytes ?? (async (path) => new Uint8Array(await readFile(path)))
  }

  /** Reset the once-per-session size warning latch for a document key (or all keys when omitted). */
  resetSessionWarnings(docKey?: string): void {
    if (docKey !== undefined) {
      this.warnedDocs.delete(docKey)
    } else {
      this.warnedDocs.clear()
    }
  }

  private async resolveLimits(): Promise<DocumentLimits> {
    if (!this.deps.limits) return DEFAULT_DOCUMENT_LIMITS
    try {
      if (typeof this.deps.limits === 'function') {
        return await this.deps.limits()
      }
      return await this.deps.limits.get()
    } catch {
      return DEFAULT_DOCUMENT_LIMITS
    }
  }

  isSaving(path: string): boolean {
    return this.saving.has(path)
  }

  /**
   * Whether the queue engine is running this document key right now. The
   * inline pipeline asks before it starts, so one intent never has two writers
   * (G506-be-1). The dispatcher exposes no public in-flight state, so the
   * service supplies this from the pass it drives (see `dispatcherBusy`).
   */
  private dispatcherActive(docKey: string): boolean {
    return this.deps.dispatcherBusy?.(docKey) === true
  }

  /** resolves once the running save of `path` (if any) has finished */
  async settled(path: string): Promise<void> {
    await this.running.get(path)?.catch(() => undefined)
  }

  /** whether the working copy has moved past its pending intent (an unsent N+1) */
  hasPendingNext(path: string): boolean {
    return this.pendingNext.has(path)
  }

  /** clears the unsent N+1 marker once the pending intent is superseded or dropped */
  clearPendingNext(path: string): void {
    this.pendingNext.delete(path)
  }

  /**
   * The UniWork step of one explicit Save of `path`. Resolves with the
   * document after the attempt (null for an unbound path); never throws.
   *
   * `userSave`: the user's own Ctrl/Cmd+S (G5-06u). A pending intent is then
   * never replayed inline and no second one is minted: the working copy's N+1
   * is only marked (`pendingNext`), the status published and the queue popover
   * requested. Other callers (Retry, the close guard) keep the inline replay.
   */
  async save(
    path: string,
    options?: { forceOffline?: boolean; userSave?: boolean },
  ): Promise<BoundDocument | null> {
    // G5-04g defence in depth: a working copy whose folder declares a store this
    // build does not read never reaches the intent, the upload or the commit,
    // even if a module somehow has it open.
    // One classify (one binding.json read) decides both the newer-store refusal
    // and the bound lookup, instead of newerStoreAt + lookup reading twice.
    const found = this.deps.store.classify(path)
    if (found.kind === 'newer') return null
    if (found.kind !== 'bound') return null
    const doc = found.doc
    if (this.saving.has(doc.path)) {
      return options?.userSave ? this.requestPopoverWhileSaving(doc, options) : doc
    }
    const b = doc.binding
    if (b.access === 'view') return doc
    if (b.state === 'conflict') return this.requestPopover(doc, options)
    // permission and existence refusals stay until the document is opened again
    if (b.state === 'blocked' && b.error !== 'quota_exceeded') {
      return this.requestPopover(doc, options)
    }
    this.saving.add(doc.path)
    // a fresh attempt replaces the last one's outcome (see uncommittedAttempts)
    this.uncommittedAttempts.delete(doc.path)
    const attempt = this.run(doc, options).catch(() =>
      this.commitState(doc, { ...doc.binding, state: 'error', error: 'server_error' }),
    )
    this.running.set(doc.path, attempt)
    try {
      const ended = await attempt
      // the attempt is over: remember that it did not move the base, so a press
      // whose reads land after it still knows the settle failed instead of
      // reading "no record, base unchanged" as "the intent is not minted yet"
      // (RBE6u4-01; see movedPastSettledSave)
      if (ended.binding.baseChecksum === doc.binding.baseChecksum) {
        this.uncommittedAttempts.add(doc.path)
      }
      return ended
    } finally {
      this.saving.delete(doc.path)
      this.running.delete(doc.path)
    }
  }

  /**
   * A user Save that changes nothing asks for the queue popover instead
   * (G5-06u). `pendingNext` is given only where the working copy was compared
   * with the pending intent: true = the copy moved past it (an unsent N+1).
   * The flag change is published inside the per-key chain from a fresh binding
   * read, so a dispatcher write that landed during this save is never
   * overwritten on the chip by the stale `doc` (RBE6u-01). Exactly one popover
   * request per call.
   */
  private async requestPopover(
    doc: BoundDocument,
    options: { userSave?: boolean } | undefined,
    pendingNext?: boolean,
  ): Promise<BoundDocument> {
    if (!options?.userSave) return doc
    if (pendingNext !== undefined) {
      const had = this.pendingNext.has(doc.path)
      if (pendingNext) this.pendingNext.add(doc.path)
      else this.pendingNext.delete(doc.path)
      if (pendingNext || had) {
        await this.serializeBinding(doc.key, async () =>
          this.publish(this.deps.store.lookup(doc.path) ?? doc),
        )
      }
    }
    this.deps.requestQueuePopover?.(doc.path)
    return doc
  }

  /**
   * The user's Ctrl/Cmd+S while an inline save of the same path is in flight
   * (RBE6u2-01). With a pending intent stored this is the same request as the
   * stored-intent branch of `run`: a read only (the running writer owns the
   * record and is never disturbed, nothing is minted or replayed), the N+1
   * marked only when the copy moved past the intent, one popover push. With no
   * intent yet (the first save is still reading or minting), or when the intent
   * store cannot be read, the early return stays: no push, nothing changed.
   * The one exception is a press whose read lost the race to the running save's
   * settle (the record is gone, the binding moved): see `movedPastSettledSave`
   * (RBE6u3-01).
   */
  private async requestPopoverWhileSaving(
    doc: BoundDocument,
    options: { userSave?: boolean },
  ): Promise<BoundDocument> {
    let moved: boolean
    try {
      const bytes = await this.readBytes(doc.path)
      const access = await this.deps.intents()
      if (access.kind !== 'ok') return doc
      const stored = await access.intents.read(doc.key, factsOf(doc, bytes.byteLength))
      if (stored && !isTerminalQueueState(stored.intent.state)) {
        moved = stored.intent.checksum !== sha256Hex(bytes)
      } else if (await this.movedPastSettledSave(doc)) {
        moved = true
      } else {
        return doc
      }
    } catch {
      return doc
    }
    return this.requestPopover(doc, options, moved)
  }

  /**
   * One read-only re-check for a press that found no live intent while the path
   * was saving. If the running save settled underneath the press, its commit
   * already moved the binding's base (the record is deleted right after): a
   * copy still different from that fresh base is an unsent N+1, so the press
   * keeps its popover (RBE6u3-01). A settle that ended without a commit leaves
   * the base where the press found it - the attempt's own outcome says so - and
   * the same copy check decides, because that copy is just as unsent
   * (RBE6u4-01). A binding that did not move while the attempt is still running
   * means the first save has not stored its intent yet (nothing to say), and a
   * clean copy has nothing to mark. Never writes, mints or replays.
   */
  private async movedPastSettledSave(doc: BoundDocument): Promise<boolean> {
    const fresh = this.deps.store.lookup(doc.path)
    if (!fresh) return false
    const committed = fresh.binding.baseChecksum !== doc.binding.baseChecksum
    if (!committed && !this.uncommittedAttempts.has(doc.path)) return false
    return sha256Hex(await this.readBytes(doc.path)) !== fresh.binding.baseChecksum
  }

  private async run(
    doc: BoundDocument,
    options?: { forceOffline?: boolean; userSave?: boolean },
  ): Promise<BoundDocument> {
    const { store } = this.deps
    let bytes: Uint8Array
    try {
      bytes = await this.readBytes(doc.path)
    } catch {
      return this.commitState(doc, { ...doc.binding, state: 'error', error: 'server_error' })
    }
    const checksum = sha256Hex(bytes)
    if (!this.deps.isSignedIn() || !this.deps.ownsBinding(doc)) {
      return this.commitState(doc, { ...doc.binding, state: 'signed-out', error: 'not_signed_in' })
    }

    const access = await this.deps.intents()
    if (access.kind !== 'ok') {
      // a locked keychain (or a session without a store) refuses the save: no
      // intent, no request, no other save path
      const error = access.kind === 'keystore_locked' ? 'keystore_locked' : 'server_error'
      const refused = await this.commitState(doc, { ...doc.binding, state: 'error', error })
      return error === 'keystore_locked' ? this.requestPopover(refused, options) : refused
    }
    // the queue dispatcher is running this same key right now: the inline
    // pipeline must not start a second writer of the one intent. The dispatcher
    // owns the record and the chip, so this returns the document untouched
    // (G506-be-1)
    const { intents } = access
    const facts = factsOf(doc, bytes.byteLength)
    if (this.dispatcherActive(doc.key)) {
      if (!options?.userSave) return doc
      // a read only (the dispatcher owns the record): the N+1 is marked only
      // when the copy really moved past the intent being dispatched (RBE6u-02)
      const running = await intents.read(doc.key, facts).catch(() => null)
      const live = running && !isTerminalQueueState(running.intent.state) ? running : null
      return this.requestPopover(doc, options, live ? live.intent.checksum !== checksum : false)
    }

    const stored = await intents.read(doc.key, facts)
    // a terminal record (cancelled / committed) is spent: the next Save mints a
    // fresh intent (the machine's own `save` rule)
    let pending = stored && !isTerminalQueueState(stored.intent.state) ? stored : null

    // bytes identical to the base never touch the network, and an unchanged
    // copy over the cap is already on the server: the no-op verdict comes first
    // so a lowered limit never marks an unchanged document failed
    // UNI-2212: a copy that still owes the server its conversion is never "unchanged": the OOXML
    // bytes equal the base the open recorded (they are what the converter produced), yet the
    // server's live version is still the legacy file, so the explicit Save must commit them
    const unchangedFromBase = checksum === doc.binding.baseChecksum && !doc.binding.legacyFrom
    // EL-1(a) (UNI-1645c): when the previous commit was refused with 423
    // `document_locked` (`edit_locked`), the intent is parked in `failed` with
    // `lastError: 'edit_locked'` so background polls never auto-retry it, while
    // keeping the recovery snapshot on disk. On the next explicit Save by the
    // user, supersede that parked record before minting a fresh intent so Save
    // makes one commit attempt (never opening the queue popover instead).
    if (
      pending &&
      (pending.intent.lastError === 'edit_locked' || doc.binding.state === 'edit_locked') &&
      !IN_FLIGHT_QUEUE_STATES.has(pending.intent.state)
    ) {
      await this.settleRecord(intents, doc, pending.intent, { type: 'supersede' })
      if (unchangedFromBase) {
        await this.cleanupIntent(intents, doc, pending.intent)
      }
      pending = null
    }
    if (!pending && unchangedFromBase) {
      return await this.commitState(doc, withoutError({ ...doc.binding, state: 'saved' }))
    }

    if (!unchangedFromBase) {
      const limits = await this.resolveLimits()
      if (bytes.byteLength > limits.max_bytes) {
        if (pending && !IN_FLIGHT_QUEUE_STATES.has(pending.intent.state)) {
          const priorSession = pending.intent.uploadSession
          await this.deps.dispatcher?.supersede({
            key: doc.key,
            path: doc.path,
            filename: doc.binding.filename,
            format: doc.binding.format,
            orgId: doc.binding.orgId,
            workspaceId: doc.binding.workspaceId,
            baseVersion: doc.binding.baseVersion,
            record: pending.intent,
            payload: pending.payload,
          })
          if (!this.deps.dispatcher) {
            await this.releaseUploadSession(doc.key, priorSession)
          }
          await this.cleanupIntent(intents, doc, pending.intent)
        }
        this.pendingNext.delete(doc.path)
        this.activeSizeWarns.delete(doc.path)
        this.tooLargePromptSeq += 1
        this.activeTooLargePrompt.set(doc.path, this.tooLargePromptSeq)
        let failedDoc: BoundDocument
        try {
          failedDoc = await this.commitState(doc, {
            ...doc.binding,
            state: 'failed',
            error: 'too_large',
            sizeBytes: bytes.byteLength,
            maxBytes: limits.max_bytes,
          })
        } finally {
          this.activeTooLargePrompt.delete(doc.path)
        }
        return failedDoc
      }

      if (bytes.byteLength >= limits.warn_bytes) {
        if (!this.warnedDocs.has(doc.key)) {
          this.activeSizeWarns.set(doc.path, {
            sizeBytes: bytes.byteLength,
            maxBytes: limits.max_bytes,
          })
        } else {
          this.activeSizeWarns.delete(doc.path)
        }
      } else {
        this.warnedDocs.delete(doc.key)
        this.activeSizeWarns.delete(doc.path)
      }
    } else {
      this.activeSizeWarns.delete(doc.path)
      if (pending && !IN_FLIGHT_QUEUE_STATES.has(pending.intent.state)) {
        const limits = await this.resolveLimits()
        if (pending.payload.byteLength > limits.max_bytes) {
          const priorSession = pending.intent.uploadSession
          await this.deps.dispatcher?.supersede({
            key: doc.key,
            path: doc.path,
            filename: doc.binding.filename,
            format: doc.binding.format,
            orgId: doc.binding.orgId,
            workspaceId: doc.binding.workspaceId,
            baseVersion: doc.binding.baseVersion,
            record: pending.intent,
            payload: pending.payload,
          })
          if (!this.deps.dispatcher) {
            await this.releaseUploadSession(doc.key, priorSession)
          }
          await this.cleanupIntent(intents, doc, pending.intent)
          return await this.commitState(doc, withoutError({ ...doc.binding, state: 'saved' }))
        }
      }
    }

    try {
      let intent: IntentRecordV2 | null = pending?.intent ?? null
      let payload: Uint8Array | null = pending?.payload ?? null
      let binding = doc.binding
      if (!intent) {
        // the Ctrl/Cmd+S decision table: the intent's first state (see the module doc)
        const verdict = options?.forceOffline
          ? 'offline'
          : await laneVerdict(this.deps.capability, binding.orgId)
        const pausedUser = (await this.deps.pause?.isPaused().catch(() => false)) === true
        // the fresh intent is one past the record the store still holds (the
        // same aging QueueDispatcher.mint applies): a second inline save of one
        // document, or an N+1 minted while N commits, is never erased by N's
        // generation-correct cleanup (G5-06 fix-C item 3)
        const minted = this.mintIntent(
          doc,
          facts,
          checksum,
          nextIntentGeneration(parseStoredIntent((await intents.get(doc.key))?.intent ?? null)),
        )
        const state: IntentRecordV2['state'] =
          verdict === 'offline'
            ? 'paused_offline'
            : verdict === 'sync_write_off'
              ? 'paused_admin'
              : pausedUser
                ? 'paused_user'
                : 'queued'
        minted.state = state
        const written = await intents.put(doc.key, minted, bytes)
        if (written.kind === 'store_full') {
          this.activeSizeWarns.delete(doc.path)
          const refused = await this.commitState(doc, {
            ...doc.binding,
            state: 'error',
            error: 'store_full',
          })
          return await this.requestPopover(refused, options)
        }
        if (written.kind === 'interrupted') {
          // the account boundary wiped the scope under this save
          this.activeSizeWarns.delete(doc.path)
          return await this.commitState(doc, {
            ...doc.binding,
            state: 'signed-out',
            error: 'not_signed_in',
          })
        }
        if (written.kind !== 'ok') {
          this.activeSizeWarns.delete(doc.path)
          return await this.commitState(doc, {
            ...doc.binding,
            state: 'error',
            error: 'server_error',
          })
        }
        intent = minted
        payload = bytes
        this.trace(minted, { type: 'minted' })
        // a paused intent is recorded and shown, never dispatched
        if (state !== 'queued') {
          this.pendingNext.delete(doc.path)
          return await this.commitState(doc, { ...doc.binding, state, error: errorForState(state) })
        }
      } else if (options?.userSave) {
        // G5-06u: the user's Ctrl/Cmd+S with an intent pending: never a second
        // intent and no inline replay (a paused_user / paused_admin intent stays
        // paused); the N+1 is marked only when the copy moved past the intent
        // (RBE6u-02) and the queue popover tells the user why
        return await this.requestPopover(doc, options, checksum !== intent.checksum)
      } else {
        // an intent is already pending: never a second one. The status says so
        // (pendingNext = an unsent N+1) and the SAME record and key are replayed
        // below; a save that lands settles this very intent
        this.pendingNext.add(doc.path)
        // R1: only a record the queue would really re-send may be replayed
        // inline. A record whose commit may ALREADY be on the wire
        // (`committing` / `reconciling`) is never uploaded and never POSTed
        // again: exactly ONE lookup of the SAME key decides, exactly as the
        // poll's own tick does. A record the queue already gave up on
        // (`reconciling-stuck`) sends nothing at all and publishes the state the
        // record really has.
        if (intent.state === 'committing' || intent.state === 'reconciling') {
          return await this.lookupInFlightRecord(doc, intent, intents)
        }
        if (intent.state === 'reconciling-stuck') {
          return await this.commitState(doc, {
            ...doc.binding,
            state: 'reconciling-stuck',
            error: 'intent_unknown',
          })
        }
        // R3: a parked-offline record is provably unsent, and the machine's own
        // `online` event takes it back to `queued` (or leaves it `paused_user`
        // while the user's own pause holds). That existing transition is applied
        // first, so the phase sequence below really walks `dispatch` →
        // `uploaded` → `uploaded` and the durable record reaches `committing`
        // before the POST. When the requeue does not happen - the user's pause
        // holds, the store refused the write, a newer generation owns the key -
        // nothing is sent and the chip shows the state the record really has.
        if (intent.state === 'paused_offline') {
          const requeued = await this.requeueForReplay(doc, intent, intents)
          if (!requeued) {
            return await this.commitState(doc, {
              ...doc.binding,
              state: 'paused_offline',
              error: 'network',
            })
          }
          intent = requeued
        }
      }
      binding = withoutError({ ...binding, state: 'saving' })
      // the binding is persisted before the first network call: a crash or quit
      // replays the stored intent, and an intent that could not be recorded is
      // never sent
      try {
        // the sweep still owns this copy: no rewrite, no request, nothing sent
        if (!(await store.write(doc.dir, binding))) return doc
      } catch {
        this.activeSizeWarns.delete(doc.path)
        return await this.commitState(doc, {
          ...doc.binding,
          state: 'error',
          error: 'server_error',
        })
      }
      const saving: BoundDocument = { ...doc, binding }
      this.publish(saving)

      let receipt: CommitReceipt
      try {
        receipt = await this.uploadAndCommit(saving, intent, payload as Uint8Array, intents)
      } catch (error) {
        // R2: the durable record could not be driven to `committing`, so the
        // commit POST never left. Nothing was proven about the intent: it is
        // kept and the chip shows the state the store really holds (a store
        // refusal keeps today's store-error mapping).
        if (error instanceof PhaseWriteRefusedError) {
          if (error.refusal === 'store_full') {
            return await this.commitState(saving, {
              ...doc.binding,
              state: 'error',
              error: 'store_full',
            })
          }
          if (error.refusal === 'interrupted') {
            return await this.commitState(saving, {
              ...doc.binding,
              state: 'signed-out',
              error: 'not_signed_in',
            })
          }
          return await this.commitState(saving, {
            ...doc.binding,
            state: queueChipState(error.durableState ?? 'queued') ?? doc.binding.state,
            ...(errorForState(error.durableState ?? 'queued')
              ? { error: errorForState(error.durableState ?? 'queued') }
              : {}),
          })
        }
        // B69-lite: the server refused the staged upload because its claim
        // expired. That is NOT "the upload is gone": the intent is kept and
        // exactly ONE lookup decides what happens to it (never a dropped intent,
        // never a fresh key minted behind the user's back).
        if (
          error instanceof UniworkDocError &&
          error.serverCode === 'document_upload_invalid' &&
          error.reason === 'file_claim_expired'
        ) {
          return await this.resumeExpiredClaim(saving, intent, intents)
        }
        if (needsRecheck(error)) {
          return await this.recheckAgainstDocument(
            saving,
            intent,
            { state: 'dirty', error: 'server_error' },
            intents,
          )
        }
        // B70: the commit POST may have landed and its answer was lost - the
        // record reconciles (a lookup with the SAME key decides) instead of
        // being re-POSTed by the next poll. Upload-leg failures keep today's
        // `offline`/`queued` mapping: they are provably before the POST.
        if (error instanceof CommitAnswerLostError) {
          return await this.reconcileLostCommit(saving, intent, error, intents)
        }
        return await this.fail(saving, intent, error, intents)
      }
      if (receipt.documentId !== intent.documentId || receipt.checksumSha256 !== intent.checksum) {
        // not evidence of this commit (a replay keeps answering the same): the
        // document says whether these bytes landed; otherwise a new key next time
        return await this.recheckAgainstDocument(
          saving,
          intent,
          { state: 'error', error: 'malformed_response' },
          intents,
        )
      }
      return await this.settle(saving, intent, receipt, intents)
    } finally {
      this.activeSizeWarns.delete(doc.path)
    }
  }

  /**
   * The v2 record of one Ctrl/Cmd+S, before its lane verdict sets the state.
   * `generation` is one past the record the store still holds under this
   * document key (the same aging `QueueDispatcher.mint` applies), so an N+1
   * minted while N commits is not erased by N's generation-correct cleanup.
   */
  private mintIntent(
    doc: BoundDocument,
    facts: IntentBindFacts,
    checksum: string,
    generation: number,
  ): IntentRecordV2 {
    const id = this.uuid()
    const at = this.now().toISOString()
    return {
      v: 2,
      intentId: `office-intent-${id}`,
      idempotencyKey: `office-key-${id}`,
      documentId: doc.binding.documentId,
      orgId: facts.orgId,
      workspaceId: facts.workspaceId,
      baseRevision: doc.binding.baseRevision,
      baseVersion: facts.baseVersion,
      checksum,
      length: facts.length,
      generation,
      state: 'queued',
      attempt: 0,
      createdAt: at,
      updatedAt: at,
      // UNI-2212: the conversion this commit declares is fixed with the intent, so a retry after
      // the binding changed (a view launch, a reopen) still sends the same one
      conversion: doc.binding.legacyFrom ? conversionFor(doc.binding.legacyFrom) : null,
    }
  }

  /** a verified commit of the intent's bytes: the base moves, the intent clears */
  private async settle(
    doc: BoundDocument,
    intent: IntentRecordV2,
    landed: { revision: string; version: number; versionId?: string },
    intents: IntentStore,
  ): Promise<BoundDocument> {
    let current: string | null
    try {
      current = sha256Hex(await this.readBytes(doc.path))
    } catch {
      current = null
    }
    const settled: Binding = withoutError({
      ...doc.binding,
      baseRevision: landed.revision,
      baseVersion: landed.version,
      baseChecksum: intent.checksum,
      // the file changed while saving: those edits are not in UniWork yet
      state: current === intent.checksum ? 'saved' : 'dirty',
      lastSavedAt: this.now().toISOString(),
    })
    delete settled.serverRevision
    // UNI-2212: the converted copy is now the live version: an ordinary OOXML document, whose
    // title the server rewrote from the legacy suffix
    if (settled.legacyFrom) {
      settled.title = convertedTitle(settled.title, settled.legacyFrom)
      delete settled.legacyFrom
    }
    // the comments anchor base moves with the base version; an unknown id is
    // dropped rather than left naming the previous version
    if (landed.versionId) settled.baseVersionId = landed.versionId
    else delete settled.baseVersionId
    this.pendingNext.delete(doc.path)
    const done = await this.commitState(doc, settled)
    // the same cleanup the dispatcher's committed transition performs: the
    // record is removed, so a committed intent is never left dispatchable.
    // Compare-then-delete: a newer intent (N+1) minted while this one settled
    // is never erased by this generation's cleanup (G5-06 fix-C item 3).
    await this.cleanupIntent(intents, doc, intent)
    this.trace(intent, { type: 'settled', now: this.now() })
    if (landed.versionId && done.binding.baseVersionId === landed.versionId) {
      this.deps.onSaved?.(done, landed.versionId)
    }
    return done
  }

  /**
   * Delete the intent's stored record, but only when the store still holds
   * exactly this intent (same intentId AND generation). A newer intent (N+1)
   * minted while this one settled - a second inline save, or another window -
   * must never be erased by this generation's cleanup (G5-06 fix-C item 3).
   */
  private async cleanupIntent(
    intents: IntentStore,
    doc: BoundDocument,
    intent: IntentRecordV2,
  ): Promise<void> {
    const stored = await intents.read(doc.key, factsOf(doc, intent.length))
    if (
      stored &&
      stored.intent.intentId === intent.intentId &&
      stored.intent.generation === intent.generation
    ) {
      await intents.delete(doc.key)
    }
  }

  /**
   * Drive the queue machine's own transition for an inline attempt that has
   * settled, and persist it, so the durable record ends exactly where the
   * dispatcher would leave it. A committed intent cleans its record up; a
   * conflict keeps the SAME intent as a durable `conflict` (never `queued`, so
   * a later poll cannot replay a save the card says must stop). A record that
   * cannot be read or written is left as it is: nothing moves without being
   * persisted.
   *
   * Compare-then-put, like `cleanupIntent` and the dispatcher's `apply` guard
   * (OQ-F12-be-d3-1): only the record this attempt's own intent still owns -
   * same intentId AND generation - is settled. A newer intent (N+1) that took
   * the document key meanwhile (a second window's save, or the dispatcher) is
   * left exactly as it is: its own state is not this generation's to rewrite,
   * and a settled N must never be written over it.
   */
  private async settleRecord(
    intents: IntentStore,
    doc: BoundDocument,
    owner: IntentRecordV2,
    event: QueueEvent,
  ): Promise<PhaseWrite> {
    const stored = await intents.read(doc.key, factsOf(doc, 0))
    if (
      !stored ||
      stored.intent.intentId !== owner.intentId ||
      stored.intent.generation !== owner.generation
    ) {
      // a newer generation (N+1) owns the key: this attempt's phase is not
      // written, and the record really sits where the store says it does
      return { ok: false, refusal: 'owner_lost', state: stored?.intent.state ?? null }
    }
    const result = transition(stored.intent, event, { now: this.now().getTime() })
    if (!result.record || result.effects.some((effect) => effect.kind === 'cleanup')) {
      await this.cleanupIntent(intents, doc, stored.intent)
      return { ok: true, state: null }
    }
    const written = await intents.put(doc.key, result.record, stored.payload)
    if (written.kind !== 'ok') {
      // the store refused (or the account boundary wiped the scope): the
      // durable record still carries the state it had before this phase
      return {
        ok: false,
        refusal: written.kind === 'store_full' ? 'store_full' : 'interrupted',
        state: stored.intent.state,
      }
    }
    return { ok: true, state: result.record.state }
  }

  /**
   * B70: a lost commit answer. The record reconciles through the machine
   * (`commitFailed` from `committing` → `reconciling`, never `failed`, never
   * `offline`) and the chip follows it. The commit key is untouched: the poll's
   * tick performs the ONE lookup that decides. The binding state mirrors what
   * `queueChipState` maps for `reconciling`, so the chip and the record agree
   * even before the dispatcher's own publish lands.
   */
  private async reconcileLostCommit(
    doc: BoundDocument,
    intent: IntentRecordV2,
    error: UniworkDocError,
    intents: IntentStore,
  ): Promise<BoundDocument> {
    await this.settleRecord(intents, doc, intent, {
      type: 'commitFailed',
      error: error.code,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    })
    return this.commitState(doc, { ...doc.binding, state: 'reconciling' })
  }

  /**
   * R1: a Save met a record whose commit may already be on the wire
   * (`committing` / `reconciling`). Nothing is uploaded and nothing is POSTed:
   * exactly ONE lookup of the record's own commit key decides, and only its
   * answer moves the record - the same verdicts `resumeExpiredClaim` applies to
   * the same machine event. A lookup that cannot be answered leaves the record
   * `reconciling` for the next poll's tick.
   */
  private async lookupInFlightRecord(
    doc: BoundDocument,
    intent: IntentRecordV2,
    intents: IntentStore,
  ): Promise<BoundDocument> {
    if (intent.state === 'committing') {
      // N3: a crash-left `committing` row must DURABLY enter `reconciling`
      // before the lookup (the same `commitFailed` transition `resumeExpiredClaim`
      // applies for R7), so a lookup that fails transiently leaves an aging
      // `reconciling` row with `reconcileSince` instead of a `committing` row
      // the tick cannot age. A refused transition keeps the intent and sends nothing.
      const entered = await this.settleRecord(intents, doc, intent, {
        type: 'commitFailed',
        error: 'ticket_expired',
      })
      if (!entered.ok || entered.state !== 'reconciling') {
        if (!entered.ok && entered.refusal === 'store_full') {
          return this.commitState(doc, { ...doc.binding, state: 'error', error: 'store_full' })
        }
        if (!entered.ok && entered.refusal === 'interrupted') {
          return this.commitState(doc, {
            ...doc.binding,
            state: 'signed-out',
            error: 'not_signed_in',
          })
        }
        const durable = entered.state ?? 'committing'
        return this.commitState(doc, {
          ...doc.binding,
          state: queueChipState(durable) ?? doc.binding.state,
          ...(errorForState(durable) ? { error: errorForState(durable) } : {}),
        })
      }
    }
    const lookup = this.deps.client.lookupCommit
    if (!lookup) {
      await this.settleRecord(intents, doc, intent, { type: 'commitFailed', error: 'network' })
      return this.commitState(doc, { ...doc.binding, state: 'reconciling' })
    }
    let answer: CommitLookup
    try {
      answer = await lookup({
        documentId: intent.documentId,
        idempotencyKey: intent.idempotencyKey,
      })
    } catch (error) {
      const retryAfterMs = error instanceof UniworkDocError ? error.retryAfterMs : undefined
      await this.settleRecord(intents, doc, intent, {
        type: 'lookup',
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        error: error instanceof UniworkDocError ? error.code : 'server_error',
      })
      return this.commitState(doc, { ...doc.binding, state: 'reconciling' })
    }
    if (answer.outcome === 'committed') {
      return await this.settle(
        doc,
        intent,
        {
          revision: answer.receipt.revision,
          version: answer.receipt.version,
          versionId: answer.receipt.versionId,
        },
        intents,
      )
    }
    await this.settleRecord(intents, doc, intent, { type: 'lookup', outcome: answer.outcome })
    if (answer.outcome === 'unknown') {
      return this.commitState(doc, {
        ...doc.binding,
        state: 'reconciling-stuck',
        error: 'intent_unknown',
      })
    }
    if (answer.outcome === 'not_committed') {
      return this.commitState(doc, withoutError({ ...doc.binding, state: 'queued' }))
    }
    return this.commitState(doc, { ...doc.binding, state: 'reconciling' })
  }

  /**
   * R3: the machine's own requeue of a parked-offline record - the `online`
   * event a connectivity flip drives (`paused_offline` → `queued`, or
   * `paused_user` while the user's own pause holds), applied inline and
   * persisted BEFORE the replay. The record is only returned when the store
   * really took the write and the machine's verdict is `queued`; null means
   * this record must not be replayed inline (a user/admin pause holds it, the
   * store refused the write, or a newer generation owns the key).
   */
  private async requeueForReplay(
    doc: BoundDocument,
    intent: IntentRecordV2,
    intents: IntentStore,
  ): Promise<IntentRecordV2 | null> {
    if (intent.state !== 'paused_offline') return null
    const stored = await intents.read(doc.key, factsOf(doc, intent.length))
    if (
      !stored ||
      stored.intent.intentId !== intent.intentId ||
      stored.intent.generation !== intent.generation
    ) {
      return null
    }
    const pausedUser = (await this.deps.pause?.isPaused().catch(() => false)) === true
    const result = transition(
      stored.intent,
      { type: 'online', online: true },
      { now: this.now().getTime(), pausedUser },
    )
    if (!result.record || result.record.state !== 'queued') return null
    const written = await intents.put(doc.key, result.record, stored.payload)
    return written.kind === 'ok' ? result.record : null
  }

  /**
   * UNI-1918 (B69-lite): the server refused the staged upload with
   * `document_upload_invalid` / `reason=file_claim_expired`. The claim of the
   * upload this attempt staged under is gone, but the COMMIT is not thereby
   * known to have happened: exactly ONE lookup of the intent's commit key
   * decides, and only its answer moves the record.
   *
   * - `committed` → settle with the receipt;
   * - `not_committed` → attempt n+1 under the SAME commit key (the next upload
   *   stages under a fresh upload key, `uploadKeyFor`);
   * - `in_flight` → `reconciling` (the next poll's tick looks again);
   * - `unknown` → `reconciling-stuck` (never a blind resend).
   *
   * The lookup itself must never fail a save that could still be alive: a
   * transport failure (or a missing route on a caller without one) leaves the
   * record reconciling, where the poll's own lookup picks it up.
   */
  private async resumeExpiredClaim(
    doc: BoundDocument,
    intent: IntentRecordV2,
    intents: IntentStore,
  ): Promise<BoundDocument> {
    // R7: the claim expired, so the record must DURABLY reconcile before the
    // lookup - the machine's own `commitFailed` / `ticket_expired` event enters
    // `reconciling` with `reconcileSince`. A lookup that then fails transiently
    // therefore leaves an aging `reconciling` row (the stuck clock runs from
    // that age), never a `committing` row the tick cannot age.
    await this.settleRecord(intents, doc, intent, {
      type: 'commitFailed',
      error: 'ticket_expired',
    })
    const lookup = this.deps.client.lookupCommit
    if (!lookup) {
      return this.commitState(doc, { ...doc.binding, state: 'reconciling' })
    }
    let answer: CommitLookup
    try {
      answer = await lookup({
        documentId: intent.documentId,
        idempotencyKey: intent.idempotencyKey,
      })
    } catch (error) {
      // the lookup could not be answered (offline, a locked store, a 5xx):
      // nothing proves either way, so the intent reconciles and the poll retries
      const retryAfterMs = error instanceof UniworkDocError ? error.retryAfterMs : undefined
      await this.settleRecord(intents, doc, intent, {
        type: 'lookup',
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        error: error instanceof UniworkDocError ? error.code : 'server_error',
      })
      return this.commitState(doc, { ...doc.binding, state: 'reconciling' })
    }
    if (answer.outcome === 'committed') {
      return await this.settle(
        doc,
        intent,
        {
          revision: answer.receipt.revision,
          version: answer.receipt.version,
          versionId: answer.receipt.versionId,
        },
        intents,
      )
    }
    // the machine's own lookup rules: `not_committed` → attempt+1 `queued` (the
    // next attempt stages under a NEW upload key), `in_flight` → reconciling
    // with a retryAt, `unknown` → reconciling-stuck
    await this.settleRecord(intents, doc, intent, { type: 'lookup', outcome: answer.outcome })
    if (answer.outcome === 'unknown') {
      return this.commitState(doc, {
        ...doc.binding,
        state: 'reconciling-stuck',
        error: 'intent_unknown',
      })
    }
    if (answer.outcome === 'not_committed') {
      return this.commitState(doc, withoutError({ ...doc.binding, state: 'queued' }))
    }
    return this.commitState(doc, { ...doc.binding, state: 'reconciling' })
  }

  /**
   * The intent can no longer be replayed or its receipt does not verify: the
   * document's current checksum decides. Equal -> these bytes are the current
   * version (an earlier attempt committed them); 404/410 -> the document is
   * gone; a transient failure keeps the intent; otherwise the intent is
   * dropped and the next Save mints a new one on the same base.
   */
  private async recheckAgainstDocument(
    doc: BoundDocument,
    intent: IntentRecordV2,
    otherwise: { state: 'dirty' | 'error'; error: 'server_error' | 'malformed_response' },
    intents: IntentStore,
  ): Promise<BoundDocument> {
    let detail: DocumentDetail
    try {
      detail = await this.deps.client.getDocument(intent.documentId)
    } catch (error) {
      return this.fail(doc, intent, error, intents)
    }
    if (detail.id === intent.documentId && detail.file.checksumSha256 === intent.checksum) {
      return this.settle(
        doc,
        intent,
        {
          revision: detail.revision,
          version: detail.file.version,
          ...(detail.file.versionId ? { versionId: detail.file.versionId } : {}),
        },
        intents,
      )
    }
    await this.cleanupIntent(intents, doc, intent)
    this.pendingNext.delete(doc.path)
    return this.commitState(doc, { ...doc.binding, ...otherwise })
  }

  private async uploadAndCommit(
    doc: BoundDocument,
    intent: IntentRecordV2,
    payload: Uint8Array,
    intents: IntentStore,
  ): Promise<CommitReceipt> {
    const limits = await this.resolveLimits()
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController()
      this.uploadAborts.set(doc.key, controller)
      try {
        const upload = await uploadVersionBytes(this.deps.client, {
          documentId: intent.documentId,
          filename: doc.binding.filename,
          format: doc.binding.format,
          bytes: payload,
          idempotencyKey: intent.idempotencyKey,
          attempt: intent.attempt,
          limits,
          ...(intent.uploadSession ? { resume: intent.uploadSession } : {}),
          signal: controller.signal,
          onSessionState: async (state) => {
            if (state) {
              intent.uploadSession = state
              this.uploadLiveSessions.set(doc.key, state.sessionId)
            } else {
              delete intent.uploadSession
              this.uploadLiveSessions.delete(doc.key)
            }
            await this.persistUploadSession(intents, doc, intent, state)
          },
        })
        if (upload.checksumSha256 !== intent.checksum) {
          // the server staged other bytes than ours: nothing committed
          throw new UniworkDocError('malformed_response', {
            serverCode: 'upload_checksum_mismatch',
          })
        }
        // the upload can take minutes: an account switch meanwhile must not
        // commit this copy under the other account (the intent stays)
        if (!this.deps.isSignedIn() || !this.deps.ownsBinding(doc)) {
          throw new UniworkDocError('not_signed_in')
        }
        // the edit lock decides first: a parked save never reaches the durable
        // `committing` phase below, so it is replayed, not reconciled
        const prepared = (await this.deps.prepareEditLock?.(doc.path)) ?? 'proceed'
        if (prepared === 'park') {
          const holder = this.deps.editLockHolder?.(doc.path)
          throw new UniworkDocError('edit_locked', {
            status: 423,
            serverCode: 'document_locked',
            ...(holder ? { editLock: holder } : {}),
          })
        }
        const editLockId = this.deps.editLockId?.(doc.path) ?? null
        const conversion =
          intent.conversion !== undefined
            ? intent.conversion
            : doc.binding.legacyFrom
              ? conversionFor(doc.binding.legacyFrom)
              : null
        // B70 + R2: the commit is about to be POSTed, so the durable record
        // must say `committing` BEFORE the request leaves - a crash or a lost
        // answer then reads `committing`, never `queued` (which the next poll
        // would re-POST blindly). Compare-then-put: a newer intent (N+1) is
        // never clobbered. Every write is checked and the LAST one must have
        // landed as `committing`: a store refusal, an interrupted write, or a
        // key another generation now owns stops the save BEFORE the POST,
        // because nothing durable authorizes it.
        let phase: PhaseWrite = { ok: false, refusal: 'owner_lost', state: null }
        for (const event of [
          { type: 'dispatch' },
          { type: 'uploaded' },
          { type: 'uploaded' },
        ] as const) {
          phase = await this.settleRecord(intents, doc, intent, event)
          if (!phase.ok) break
        }
        if (!phase.ok || phase.state !== 'committing') {
          throw new PhaseWriteRefusedError(phase.ok ? 'owner_lost' : phase.refusal, phase.state)
        }
        try {
          return await this.deps.client.commit({
            documentId: intent.documentId,
            uploadId: upload.uploadId,
            baseRevision: intent.baseRevision,
            idempotencyKey: intent.idempotencyKey,
            ...(editLockId ? { editLockId } : {}),
            // UNI-2212: a converted copy of a legacy document declares its conversion, the one its
            // intent was minted with (an intent from before the snapshot reads the binding)
            ...(conversion ? { conversion } : {}),
          })
        } catch (error) {
          // only the COMMIT leg is tagged, and only for an answer the server
          // never gave (a network drop or a timeout): the same error before the
          // POST is provably not-committed and keeps today's `offline`/`queued`
          // mapping. A coded refusal is a real answer, and an
          // `idempotency_in_flight` keeps today's bounded retry then `offline`.
          if (
            error instanceof UniworkDocError &&
            (error.code === 'network' || error.code === 'timeout') &&
            error.serverCode !== 'idempotency_in_flight'
          ) {
            throw new CommitAnswerLostError(error)
          }
          throw error
        }
      } catch (error) {
        const inFlight =
          error instanceof UniworkDocError && error.serverCode === 'idempotency_in_flight'
        const delay = IN_FLIGHT_BACKOFF_MS[attempt]
        if (!inFlight || delay === undefined) throw error
        await this.sleep(delay)
      } finally {
        if (this.uploadAborts.get(doc.key) === controller) {
          this.uploadAborts.delete(doc.key)
          this.uploadLiveSessions.delete(doc.key)
        }
      }
    }
  }

  private async persistUploadSession(
    intents: IntentStore,
    doc: BoundDocument,
    owner: IntentRecordV2,
    session: SavedUploadSession | undefined,
  ): Promise<void> {
    const stored = await intents.read(doc.key, factsOf(doc, owner.length))
    if (
      !stored ||
      stored.intent.intentId !== owner.intentId ||
      stored.intent.generation !== owner.generation
    ) {
      return
    }
    const next: IntentRecordV2 = {
      ...stored.intent,
      updatedAt: this.now().toISOString(),
    }
    if (session) next.uploadSession = session
    else delete next.uploadSession
    await intents.put(doc.key, next, stored.payload)
  }

  private async releaseUploadSession(
    docKey: string,
    session: SavedUploadSession | undefined,
  ): Promise<void> {
    await this.takeUploadRelease(docKey, session)()
  }

  /** local half now (abort part PUTs, forget the live session); the closure is the network DELETE alone */
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
        console.warn('uniwork docs: the upload session could not be aborted', error)
      }
    }
  }

  private async fail(
    doc: BoundDocument,
    intent: IntentRecordV2,
    raw: unknown,
    intents: IntentStore,
  ): Promise<BoundDocument> {
    const error = raw instanceof UniworkDocError ? raw : new UniworkDocError('server_error')
    const ended = await this.applyFailure(doc, intent, error, intents)
    this.trace(intent, { type: 'failed', error, to: ended.binding.state, now: this.now() })
    return ended
  }

  private async applyFailure(
    doc: BoundDocument,
    intent: IntentRecordV2,
    error: UniworkDocError,
    intents: IntentStore,
  ): Promise<BoundDocument> {
    const base = doc.binding
    const dropped = isTerminalRefusal(error) && error.code !== 'too_large'
    if (dropped) {
      await this.cleanupIntent(intents, doc, intent)
      this.pendingNext.delete(doc.path)
    }
    switch (error.code) {
      case 'edit_locked':
        // EL-1(a) (UNI-1645c): HTTP 423 document_locked — someone else holds the
        // server edit lock. Never classify as conflict and never auto-retry on a
        // timer: park the intent in `failed` with `lastError: 'edit_locked'` so
        // the recovery snapshot is kept on disk until the user explicitly saves
        // again or closes the document.
        // EL-1(b): a 423 while we held also flips the session to 'lost'.
        this.deps.onCommitEditLocked?.(doc.path, error)
        this.pendingNext.delete(doc.path)
        await this.settleRecord(intents, doc, intent, {
          type: 'commitFailed',
          error: 'edit_locked',
        })
        // EL1A-BE-1: `current_revision` of a 423 is NOT the copy's new base — it is the
        // holder's head. Writing it to `serverRevision` would let a later feed notice that
        // fills `serverVersion` rebuild an S6 newer-dirty bar / Reload affordance while the
        // copy is still edit_locked. It is dropped: the pill's Retry is the only way forward.
        return this.commitState(doc, {
          ...base,
          state: 'edit_locked',
          error: 'edit_locked',
          editLock: error.editLock ?? {
            holderName: null,
            since: null,
            expiresAt: null,
            heldByMe: false,
          },
        })
      case 'conflict':
        // the working copy and the base stay; the user chooses what happens next.
        // The intent is durable: the SAME record and key survive the conflict,
        // and the record itself ends `conflict` (never `queued`) so the next
        // poll never replays it (G506-be-1)
        await this.settleRecord(intents, doc, intent, {
          type: 'commitFailed',
          error: 'conflict',
        })
        return this.commitState(doc, {
          ...base,
          state: 'conflict',
          error: 'conflict',
          ...(error.currentRevision ? { serverRevision: error.currentRevision } : {}),
        })
      case 'capability_off':
        // never blocked: the admin turned sync_write off. Same intent, no request
        return this.commitState(doc, { ...base, state: 'paused_admin', error: 'capability_off' })
      case 'permission_revoked':
        return this.commitState(doc, {
          ...base,
          state: 'blocked',
          error: 'permission_revoked',
          access: 'view',
          // a fact about the server's answer, also for a binding written before levels existed
          level: 'view' as const,
        })
      case 'member_deactivated':
      case 'organization_suspended':
        return this.commitState(doc, { ...base, state: 'blocked', error: error.code })
      case 'intent_unknown':
        // "unknown" is never queued and never deleted: it cannot be proven either way
        return this.commitState(doc, {
          ...base,
          state: 'reconciling-stuck',
          error: 'intent_unknown',
        })
      case 'ticket_expired':
        // the upload claim expired: look the intent up before touching bytes again
        return this.commitState(doc, { ...base, state: 'reconciling' })
      case 'too_large':
        // SIZE-F1 §5.2 item 3 (d1-2): keep the intent and its payload as a
        // durable `failed` record (`lastError: 'too_large'`, `maxBytes` when
        // the server named one) under the same generation guard as conflict and
        // document_archived (OQ-F12), so the payload stays untouched and no
        // poll auto-replays it.
        this.pendingNext.delete(doc.path)
        await this.settleRecord(intents, doc, intent, {
          type: 'commitFailed',
          error: 'too_large',
          ...(error.maxBytes !== undefined ? { maxBytes: error.maxBytes } : {}),
        })
        return this.commitState(doc, {
          ...base,
          state: 'failed',
          error: 'too_large',
          sizeBytes: error.sizeBytes ?? intent.length,
          ...(error.maxBytes !== undefined ? { maxBytes: error.maxBytes } : {}),
        })
      case 'legacy_conversion_invalid':
        // UNI-2212: the converted copy was refused as the next version of its legacy document.
        // The edits are never dropped: the intent stays as a durable `failed` record (the same
        // place a too_large one parks) so no poll replays it, and the converted local copy is
        // still the working copy - the user can keep it, save it locally or save a copy.
        this.pendingNext.delete(doc.path)
        await this.settleRecord(intents, doc, intent, {
          type: 'commitFailed',
          error: 'legacy_conversion_invalid',
        })
        return this.commitState(doc, {
          ...base,
          state: 'failed',
          error: 'legacy_conversion_invalid',
        })
      case 'quota_exceeded':
      case 'not_found':
      case 'document_deleted':
      case 'deleted':
        return this.commitState(doc, { ...base, state: 'blocked', error: error.code })
      case 'document_archived':
        // the archive is reversible, so this refusal is NOT terminal and the
        // intent is kept (errors.ts:170-173). Unlike the codes above - whose
        // record `cleanupIntent` has already dropped - this one is still stored,
        // so it is parked in the SAME call the chip is parked with, exactly as
        // the conflict branch does: a record left `queued` would show the sync
        // center a pending row the pill already calls blocked, and the next poll
        // would spend one more refused upload+commit on bytes the server has
        // already refused (OQ-F12-be-d2-2)
        await this.settleRecord(intents, doc, intent, {
          type: 'commitFailed',
          error: 'document_archived',
        })
        return this.commitState(doc, { ...base, state: 'blocked', error: error.code })
      case 'session_expired':
      case 'not_signed_in':
      case 'wrong_deployment':
        return this.commitState(doc, { ...base, state: 'signed-out', error: error.code })
      case 'network':
      case 'timeout':
        return this.commitState(doc, { ...base, state: 'offline', error: error.code })
      case 'server_error':
        return this.commitState(doc, {
          ...base,
          state: dropped ? 'error' : 'offline',
          error: 'server_error',
        })
      default:
        return this.commitState(doc, { ...base, state: 'error', error: error.code })
    }
  }

  // ---- the queue front the W4b stage wires ---------------------------------

  /**
   * "Tam dung gui" (pause sending, per account): the durable flag stops new
   * intents from being dispatched. Nothing is deleted and an in-flight commit
   * runs to its receipt (see EXPERIENCE - Pause/resume gui).
   */
  async pause(): Promise<void> {
    await this.deps.pause?.setPaused(true)
  }

  /** "Tiep tuc gui" (resume sending): clear the flag and move waiting intents back to queued */
  async resume(docs: QueueDoc[]): Promise<void> {
    await this.deps.dispatcher?.resume(docs)
  }

  /**
   * "Huy lan luu" (cancel intent): only an intent that provably did not commit
   * (queued / paused_* / failed / conflict). When the document is closed its
   * snapshot becomes a kept draft; a refused draft (the cap or the budget)
   * leaves the intent exactly as it was.
   */
  async cancel(
    doc: QueueDoc,
    options: { documentClosed: boolean; title?: string } = { documentClosed: false },
  ): Promise<void> {
    const priorSession = doc.record.uploadSession
    if (!this.deps.dispatcher) {
      await this.releaseUploadSession(doc.key, priorSession)
      return
    }
    const state = await this.deps.dispatcher.cancel(doc, options)
    if (state === 'cancelled') {
      await this.releaseUploadSession(doc.key, undefined)
    }
    this.publishQueueState(doc, state)
  }

  /** "Bo lan luu..." (discard a stuck save): the snapshot becomes a kept draft */
  async discard(doc: QueueDoc, options: { title?: string } = {}): Promise<void> {
    const priorSession = doc.record.uploadSession
    if (!this.deps.dispatcher) {
      await this.releaseUploadSession(doc.key, priorSession)
      return
    }
    const state = await this.deps.dispatcher.discard(doc, options)
    if (state === 'cancelled') {
      await this.releaseUploadSession(doc.key, undefined)
    }
    this.publishQueueState(doc, state)
  }

  /**
   * Overwrite / Reload / "Luu lai": the old intent is superseded BEFORE a new
   * one is minted (EXPERIENCE - Superseded, :239-242). A superseded record is
   * terminal, so it never moves the chip itself (see publishQueueState).
   */
  async supersede(doc: QueueDoc): Promise<void> {
    const release = await this.supersedeDeferRelease(doc)
    await release()
  }

  /**
   * `supersede` with the upload-session DELETE (network) returned instead of
   * awaited. A conflict action runs it after its local destructive steps, so no
   * network sits between its final validation and its last store write.
   */
  async supersedeDeferRelease(doc: QueueDoc): Promise<() => Promise<void>> {
    // a superseded record is always terminal: the machine never moves it to a
    // chip state, and the caller's Overwrite / Reload is what the binding shows
    // next. So this never publishes (publishQueueState would drop it anyway).
    const priorSession = doc.record.uploadSession
    if (!this.deps.dispatcher) return this.takeUploadRelease(doc.key, priorSession)
    const engine = this.deps.dispatcher
    if (!engine.supersedeDeferRelease) {
      const state = await engine.supersede(doc)
      if (state === 'cancelled') await this.releaseUploadSession(doc.key, undefined)
      return async () => {}
    }
    const { state, release } = await engine.supersedeDeferRelease(doc)
    if (state !== 'cancelled') return release
    // the dispatcher took its own release (retained session); the coordinator's
    // own controller / live session is released locally now, DELETE deferred
    const own = this.takeUploadRelease(doc.key, undefined)
    return async () => {
      await release()
      await own()
    }
  }

  /** "Kiem tra lai" (check again): a lookup of the intent only, never a new attempt */
  async recheck(doc: QueueDoc): Promise<void> {
    if (!this.deps.dispatcher) return
    const state = await this.deps.dispatcher.recheck(doc)
    this.publishQueueState(doc, state)
  }

  /** the document is gone (tombstone): stop replay, keep the snapshot */
  async tombstone(doc: QueueDoc): Promise<void> {
    if (!this.deps.dispatcher) return
    const state = await this.deps.dispatcher.tombstone(doc)
    this.publishQueueState(doc, state)
  }

  /** one poll pass over the pending queue documents (the caller drives the clock) */
  async dispatchAll(docs: QueueDoc[]): Promise<void> {
    await this.deps.dispatcher?.dispatchAll(docs)
  }

  /** whether another window holds the document lock (this one is read-only) */
  isOtherWindow(docKey: string): boolean {
    return this.deps.dispatcher?.isOtherWindow(docKey) === true
  }

  /**
   * A32 (UNI-1362): whether the durable document lock is held by another window
   * right now. `isOtherWindow` above is this process's own verdict and only a
   * dispatch clears it, so the status front revalidates with this one instead.
   */
  async holdsOtherWindow(docKey: string): Promise<boolean> {
    return (await this.deps.dispatcher?.holdsOtherWindow(docKey)) === true
  }

  /** push a queue record's state as the document's status (W4b maps the doc) */
  private publishQueueState(doc: QueueDoc, state: IntentRecordV2['state']): void {
    const bound = this.deps.store.lookup(doc.path)
    if (!bound) return
    // a terminal record is spent: its state is not a chip state, and the front's
    // own settle/supersede already moved the binding (never write `cancelled`)
    const chip = queueChipState(state)
    if (!chip) return
    this.deps.publish(toStatus({ ...bound, binding: { ...bound.binding, state: chip } }))
  }

  /**
   * Persists the binding, then pushes the status; a failed write still pushes.
   * A write the store refuses - the schema 1 -> 2 sweep still owns this copy -
   * is not a failure: nothing was written, so the document keeps its binding
   * (and the copy keeps its plaintext intent) and the old status is what the
   * chip shows.
   *
   * `guard`: write only while the document still carries the base (see
   * CommitBaseGuard), compared inside the per-key chain - a reload/restore that
   * committed after the decision is never overwritten by the superseded read.
   */
  async commitState(
    doc: BoundDocument,
    binding: Binding,
    guard?: CommitBaseGuard,
  ): Promise<BoundDocument> {
    // one writer per document key: the inline pipeline and the dispatcher's
    // `publish` both rewrite binding.json, so chain them (G506-be-7)
    return this.serializeBinding(doc.key, () => {
      if (!guard) return this.writeBinding(doc, binding)
      const latest = this.deps.store.lookup(doc.path)
      if (
        !latest ||
        latest.binding.baseRevision !== guard.baseRevision ||
        latest.binding.baseChecksum !== guard.baseChecksum
      ) {
        // the base moved since the decision (a reload/restore, a save): the
        // binding as it is now wins, and this write never lands
        return Promise.resolve(latest ?? doc)
      }
      return this.writeBinding(latest, binding)
    })
  }

  /**
   * Mutate `doc`'s binding against the latest stored binding inside the
   * per-key serialized chain (`serializeBinding`). Returns `null` when the
   * document is no longer bound, or the current `BoundDocument` without
   * writing when `patch` returns `null`. Propagates persistence failures
   * rather than swallowing them (R3-5).
   */
  async updateBinding(
    doc: BoundDocument,
    patch: (latest: Binding) => Binding | null,
  ): Promise<BoundDocument | null> {
    return this.serializeBinding(doc.key, async () => {
      const latest = this.deps.store.lookup(doc.path)
      if (!latest || latest.binding.documentId !== doc.binding.documentId) return null
      const next = patch(latest.binding)
      if (!next) return latest
      const written = await this.deps.store.write(latest.dir, next)
      if (!written) {
        this.activeSizeWarns.delete(latest.path)
        this.publish(latest)
        throw new Error('binding_write_refused')
      }
      const updated: BoundDocument = { ...latest, binding: next }
      this.publish(updated)
      return updated
    })
  }

  /** the binding write itself, always run inside the per-key chain */
  private async writeBinding(doc: BoundDocument, binding: Binding): Promise<BoundDocument> {
    const next: BoundDocument = { ...doc, binding }
    let written: boolean
    try {
      written = await this.deps.store.write(doc.dir, binding)
    } catch {
      // the in-memory state is still shown; the next Save writes again
      written = true
    }
    if (!written) {
      this.activeSizeWarns.delete(doc.path)
      this.publish(doc)
      return doc
    }
    this.publish(next)
    return next
  }

  private publish(doc: BoundDocument): void {
    const status = toStatus(doc, this.pendingNext.has(doc.path))
    const sizeWarn = this.activeSizeWarns.get(doc.path)
    if (sizeWarn) {
      status.sizeWarn = sizeWarn
      this.warnedDocs.add(doc.key)
    }
    const promptSeq = this.activeTooLargePrompt.get(doc.path)
    if (promptSeq !== undefined) {
      status.saveTooLargePrompt = true
      status.saveTooLargePromptSeq = promptSeq
    }
    this.deps.publish(status)
  }

  private trace(
    intent: IntentRecordV2,
    event: Parameters<typeof traceCoordinatorTransition>[1],
  ): void {
    traceCoordinatorTransition(intent, event)
  }

  /**
   * Run `run` after every binding write already queued for `key`, so the two
   * writers (the inline pipeline's `commitState` and the dispatcher's
   * `publish` -> `applyRecord`) never interleave: the later state wins in event
   * order. The stored chain never rejects, so one failed write does not poison
   * the next.
   */
  private serializeBinding<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.bindingChains.get(key) ?? Promise.resolve()
    const result = previous.then(run)
    this.bindingChains.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    )
    return result
  }
}

/** the refusal reason a paused intent reports (a queued intent carries none) */
function errorForState(state: IntentRecordV2['state']): Binding['error'] | undefined {
  if (state === 'paused_admin') return 'capability_off'
  if (state === 'paused_offline') return 'network'
  return undefined
}

/**
 * The chip state a queue record maps onto, or null for a record that must not
 * move the binding: a committed/cancelled record is spent. The three in-flight
 * states read as the umbrella `saving`.
 */
export function queueChipState(state: IntentRecordV2['state']): Binding['state'] | null {
  if (state === 'committed' || state === 'cancelled') return null
  if (state === 'validating' || state === 'uploading' || state === 'committing') return 'saving'
  return state as Binding['state']
}

export { QUEUE_LIMITS }
