import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { UniworkDocStatus } from '../../shared/home-api'
import type { Binding, BindingStore, BoundDocument } from './binding-store'
import type { UniworkDocsClient } from './client'
import { UniworkDocError, isTerminalRefusal } from './errors'
import { sha256Hex } from './formats'
import type { CommitReceipt, DocumentDetail } from './parse'
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
>

export interface SaveCoordinatorDeps {
  store: BindingStore
  client: Pick<UniworkDocsClient, 'upload' | 'commit' | 'getDocument'>
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
    access: b.access,
    state: b.state,
    ...(b.error ? { error: b.error } : {}),
    ...(b.lastSavedAt ? { lastSavedAt: b.lastSavedAt } : {}),
    ...(pendingNext ? { pendingNext } : {}),
  }
}

function withoutError(binding: Binding): Binding {
  const next = { ...binding }
  delete next.error
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
  private readonly now: () => Date
  private readonly uuid: () => string
  private readonly sleep: (ms: number) => Promise<void>
  private readonly readBytes: (path: string) => Promise<Uint8Array>

  constructor(deps: SaveCoordinatorDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
    this.uuid = deps.uuid ?? randomUUID
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.readBytes = deps.readBytes ?? (async (path) => new Uint8Array(await readFile(path)))
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
    const pending = stored && !isTerminalQueueState(stored.intent.state) ? stored : null
    let intent: IntentRecordV2 | null = pending?.intent ?? null
    let payload: Uint8Array | null = pending?.payload ?? null
    let binding = doc.binding
    if (!intent) {
      if (checksum === binding.baseChecksum) {
        return this.commitState(doc, withoutError({ ...binding, state: 'saved' }))
      }
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
        const refused = await this.commitState(doc, {
          ...doc.binding,
          state: 'error',
          error: 'store_full',
        })
        return this.requestPopover(refused, options)
      }
      if (written.kind === 'interrupted') {
        // the account boundary wiped the scope under this save
        return this.commitState(doc, {
          ...doc.binding,
          state: 'signed-out',
          error: 'not_signed_in',
        })
      }
      if (written.kind !== 'ok') {
        return this.commitState(doc, { ...doc.binding, state: 'error', error: 'server_error' })
      }
      intent = minted
      payload = bytes
      this.trace(minted, { type: 'minted' })
      // a paused intent is recorded and shown, never dispatched
      if (state !== 'queued') {
        this.pendingNext.delete(doc.path)
        return this.commitState(doc, { ...doc.binding, state, error: errorForState(state) })
      }
    } else if (options?.userSave) {
      // G5-06u: the user's Ctrl/Cmd+S with an intent pending: never a second
      // intent and no inline replay (a paused_user / paused_admin intent stays
      // paused); the N+1 is marked only when the copy moved past the intent
      // (RBE6u-02) and the queue popover tells the user why
      return this.requestPopover(doc, options, checksum !== intent.checksum)
    } else {
      // an intent is already pending: never a second one. The status says so
      // (pendingNext = an unsent N+1) and the SAME record and key are replayed
      // below; a save that lands settles this very intent
      this.pendingNext.add(doc.path)
    }
    binding = withoutError({ ...binding, state: 'saving' })
    // the binding is persisted before the first network call: a crash or quit
    // replays the stored intent, and an intent that could not be recorded is
    // never sent
    try {
      // the sweep still owns this copy: no rewrite, no request, nothing sent
      if (!(await store.write(doc.dir, binding))) return doc
    } catch {
      return this.commitState(doc, { ...doc.binding, state: 'error', error: 'server_error' })
    }
    const saving: BoundDocument = { ...doc, binding }
    this.publish(saving)

    let receipt: CommitReceipt
    try {
      receipt = await this.uploadAndCommit(saving, intent, payload as Uint8Array)
    } catch (error) {
      if (needsRecheck(error)) {
        return this.recheckAgainstDocument(
          saving,
          intent,
          { state: 'dirty', error: 'server_error' },
          intents,
        )
      }
      return this.fail(saving, intent, error, intents)
    }
    if (receipt.documentId !== intent.documentId || receipt.checksumSha256 !== intent.checksum) {
      // not evidence of this commit (a replay keeps answering the same): the
      // document says whether these bytes landed; otherwise a new key next time
      return this.recheckAgainstDocument(
        saving,
        intent,
        { state: 'error', error: 'malformed_response' },
        intents,
      )
    }
    return this.settle(saving, intent, receipt, intents)
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
   */
  private async settleRecord(
    intents: IntentStore,
    doc: BoundDocument,
    event: QueueEvent,
  ): Promise<void> {
    const stored = await intents.read(doc.key, factsOf(doc, 0))
    if (!stored) return
    const result = transition(stored.intent, event, { now: this.now().getTime() })
    if (!result.record || result.effects.some((effect) => effect.kind === 'cleanup')) {
      await this.cleanupIntent(intents, doc, stored.intent)
      return
    }
    await intents.put(doc.key, result.record, stored.payload)
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
  ): Promise<CommitReceipt> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const upload = await this.deps.client.upload({
          documentId: intent.documentId,
          bytes: payload,
          filename: doc.binding.filename,
          format: doc.binding.format,
          idempotencyKey: intent.idempotencyKey,
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
        return await this.deps.client.commit({
          documentId: intent.documentId,
          uploadId: upload.uploadId,
          baseRevision: intent.baseRevision,
          idempotencyKey: intent.idempotencyKey,
        })
      } catch (error) {
        const inFlight =
          error instanceof UniworkDocError && error.serverCode === 'idempotency_in_flight'
        const delay = IN_FLIGHT_BACKOFF_MS[attempt]
        if (!inFlight || delay === undefined) throw error
        await this.sleep(delay)
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
    const dropped = isTerminalRefusal(error)
    if (dropped) {
      await this.cleanupIntent(intents, doc, intent)
      this.pendingNext.delete(doc.path)
    }
    switch (error.code) {
      case 'conflict':
        // the working copy and the base stay; the user chooses what happens next.
        // The intent is durable: the SAME record and key survive the conflict,
        // and the record itself ends `conflict` (never `queued`) so the next
        // poll never replays it (G506-be-1)
        await this.settleRecord(intents, doc, { type: 'commitFailed', error: 'conflict' })
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
      case 'quota_exceeded':
      case 'not_found':
      case 'document_deleted':
      case 'deleted':
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
    if (!this.deps.dispatcher) return
    const state = await this.deps.dispatcher.cancel(doc, options)
    this.publishQueueState(doc, state)
  }

  /** "Bo lan luu..." (discard a stuck save): the snapshot becomes a kept draft */
  async discard(doc: QueueDoc, options: { title?: string } = {}): Promise<void> {
    if (!this.deps.dispatcher) return
    const state = await this.deps.dispatcher.discard(doc, options)
    this.publishQueueState(doc, state)
  }

  /**
   * Overwrite / Reload / "Luu lai": the old intent is superseded BEFORE a new
   * one is minted (EXPERIENCE - Superseded, :239-242). A superseded record is
   * terminal, so it never moves the chip itself (see publishQueueState).
   */
  async supersede(doc: QueueDoc): Promise<void> {
    // a superseded record is always terminal: the machine never moves it to a
    // chip state, and the caller's Overwrite / Reload is what the binding shows
    // next. So this never publishes (publishQueueState would drop it anyway).
    await this.deps.dispatcher?.supersede(doc)
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
      this.publish(doc)
      return doc
    }
    this.publish(next)
    return next
  }

  private publish(doc: BoundDocument): void {
    this.deps.publish(toStatus(doc, this.pendingNext.has(doc.path)))
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
