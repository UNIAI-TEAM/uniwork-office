import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { UniworkDocStatus } from '../../shared/home-api'
import type { Binding, BindingStore, BoundDocument, PendingIntent } from './binding-store'
import type { UniworkDocsClient } from './client'
import { UniworkDocError, isTerminalRefusal } from './errors'
import { sha256Hex } from './formats'
import type { CommitReceipt, DocumentDetail } from './parse'

/**
 * Saves a bound working copy to UniWork, once per explicit user Save. The
 * module has already written the bytes locally (that step always succeeds
 * first); this is only the UniWork step:
 *
 * - the intent (key, base revision, checksum) and its payload are persisted
 *   BEFORE any network call;
 * - upload, then commit with the SAME Idempotency-Key; only a commit receipt
 *   for this document whose checksum equals the intent's moves the base;
 * - timeout / network / 5xx / malformed keep the intent, and the next Save
 *   replays the same intent and key first (the server returns the stored
 *   result when it already committed);
 * - a refusal that proves nothing committed (409 conflict, 403, payload
 *   mismatch, ...) drops the intent;
 * - a staged upload that is gone (expired claim, 404 on upload/commit) or a
 *   receipt that does not verify is checked against the document itself: its
 *   current checksum equal to the intent's settles the save, a 404/410 there
 *   blocks the document, anything else drops the intent so the next Save
 *   mints a new one from the current bytes on the same base;
 * - the account that started the save must still be the signed-in one when
 *   the commit is sent (an account switch mid-upload never commits);
 * - while saving, another Save returns at once (no queue); bytes identical to
 *   the base never touch the network; a conflict refuses every Save until the
 *   user resolves it; a view-only document never reaches the network.
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

export interface SaveCoordinatorDeps {
  store: BindingStore
  client: Pick<UniworkDocsClient, 'upload' | 'commit' | 'getDocument'>
  isSignedIn(): boolean
  /** the binding belongs to the signed-in account and the active deployment */
  ownsBinding(doc: BoundDocument): boolean
  /** status push for every state change */
  publish(status: UniworkDocStatus): void
  now?(): Date
  uuid?(): string
  sleep?(ms: number): Promise<void>
  readBytes?(path: string): Promise<Uint8Array>
}

export function toStatus(doc: BoundDocument): UniworkDocStatus {
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
  }
}

function withoutError(binding: Binding): Binding {
  const next = { ...binding }
  delete next.error
  return next
}

function withoutIntent(binding: Binding): Binding {
  const next = { ...binding }
  delete next.pendingIntent
  return next
}

export class SaveCoordinator {
  private readonly deps: SaveCoordinatorDeps
  private readonly saving = new Set<string>()
  private readonly running = new Map<string, Promise<BoundDocument>>()
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

  /** resolves once the running save of `path` (if any) has finished */
  async settled(path: string): Promise<void> {
    await this.running.get(path)?.catch(() => undefined)
  }

  /**
   * The UniWork step of one explicit Save of `path`. Resolves with the
   * document after the attempt (null for an unbound path); never throws.
   */
  async save(path: string): Promise<BoundDocument | null> {
    const doc = this.deps.store.lookup(path)
    if (!doc) return null
    if (this.saving.has(doc.path)) return doc
    const b = doc.binding
    if (b.access === 'view') return doc
    if (b.state === 'conflict') return doc
    // permission and existence refusals stay until the document is opened again
    if (b.state === 'blocked' && b.error !== 'quota_exceeded') return doc
    this.saving.add(doc.path)
    const attempt = this.run(doc).catch(() =>
      this.commitState(doc, { ...doc.binding, state: 'error', error: 'server_error' }),
    )
    this.running.set(doc.path, attempt)
    try {
      return await attempt
    } finally {
      this.saving.delete(doc.path)
      this.running.delete(doc.path)
    }
  }

  private async run(doc: BoundDocument): Promise<BoundDocument> {
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

    let intent = doc.binding.pendingIntent
    let payload: Uint8Array | null = null
    if (intent) {
      payload = await store.readIntentPayload(doc.dir)
      if (!payload || sha256Hex(payload) !== intent.checksum) {
        // the replay must send the intent's own bytes; when they are gone the
        // file itself still is them, or the intent cannot be replayed at all
        payload = checksum === intent.checksum ? bytes : null
        if (!payload) intent = undefined
      }
    }
    let binding = doc.binding
    if (!intent) {
      if (checksum === binding.baseChecksum) {
        return this.commitState(doc, withoutIntent(withoutError({ ...binding, state: 'saved' })))
      }
      const id = this.uuid()
      intent = {
        intentId: `office-intent-${id}`,
        idempotencyKey: `office-key-${id}`,
        documentId: binding.documentId,
        baseRevision: binding.baseRevision,
        checksum,
        createdAt: this.now().toISOString(),
      }
      payload = bytes
      await store.writeIntentPayload(doc.dir, payload)
    }
    binding = withoutError({ ...binding, pendingIntent: intent, state: 'saving' })
    // persisted before the first network call: a crash or quit replays this
    // intent, and an intent that could not be recorded is never sent
    try {
      await store.write(doc.dir, binding)
    } catch {
      return this.commitState(doc, { ...doc.binding, state: 'error', error: 'server_error' })
    }
    const saving: BoundDocument = { ...doc, binding }
    this.deps.publish(toStatus(saving))

    let receipt: CommitReceipt
    try {
      receipt = await this.uploadAndCommit(saving, intent, payload as Uint8Array)
    } catch (error) {
      if (needsRecheck(error)) {
        return this.recheck(saving, intent, { state: 'dirty', error: 'server_error' })
      }
      return this.fail(saving, intent, error)
    }
    if (receipt.documentId !== intent.documentId || receipt.checksumSha256 !== intent.checksum) {
      // not evidence of this commit (a replay keeps answering the same): the
      // document says whether these bytes landed; otherwise a new key next time
      return this.recheck(saving, intent, { state: 'error', error: 'malformed_response' })
    }
    return this.settle(saving, intent, receipt)
  }

  /** a verified commit of the intent's bytes: the base moves, the intent clears */
  private async settle(
    doc: BoundDocument,
    intent: PendingIntent,
    landed: { revision: string; version: number },
  ): Promise<BoundDocument> {
    let current: string | null = null
    try {
      current = sha256Hex(await this.readBytes(doc.path))
    } catch {
      current = null
    }
    const settled: Binding = withoutIntent(
      withoutError({
        ...doc.binding,
        baseRevision: landed.revision,
        baseVersion: landed.version,
        baseChecksum: intent.checksum,
        // the file changed while saving: those edits are not in UniWork yet
        state: current === intent.checksum ? 'saved' : 'dirty',
        lastSavedAt: this.now().toISOString(),
      }),
    )
    delete settled.serverRevision
    const done = await this.commitState(doc, settled)
    await this.deps.store.dropIntentPayload(doc.dir)
    return done
  }

  /**
   * The intent can no longer be replayed or its receipt does not verify: the
   * document's current checksum decides. Equal -> these bytes are the current
   * version (an earlier attempt committed them); 404/410 -> the document is
   * gone; a transient failure keeps the intent; otherwise the intent is
   * dropped and the next Save mints a new one on the same base.
   */
  private async recheck(
    doc: BoundDocument,
    intent: PendingIntent,
    otherwise: { state: 'dirty' | 'error'; error: 'server_error' | 'malformed_response' },
  ): Promise<BoundDocument> {
    let detail: DocumentDetail
    try {
      detail = await this.deps.client.getDocument(intent.documentId)
    } catch (error) {
      return this.fail(doc, intent, error)
    }
    if (detail.id === intent.documentId && detail.file.checksumSha256 === intent.checksum) {
      return this.settle(doc, intent, { revision: detail.revision, version: detail.file.version })
    }
    await this.deps.store.dropIntentPayload(doc.dir)
    return this.commitState(doc, { ...withoutIntent(doc.binding), ...otherwise })
  }

  private async uploadAndCommit(
    doc: BoundDocument,
    intent: PendingIntent,
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
    intent: PendingIntent,
    raw: unknown,
  ): Promise<BoundDocument> {
    const error = raw instanceof UniworkDocError ? raw : new UniworkDocError('server_error')
    const b = doc.binding
    const dropped = isTerminalRefusal(error)
    if (dropped) await this.deps.store.dropIntentPayload(doc.dir)
    const base = dropped ? withoutIntent(b) : { ...b, pendingIntent: intent }
    switch (error.code) {
      case 'conflict':
        // the working copy and the base stay; the user chooses what happens next
        return this.commitState(doc, {
          ...base,
          state: 'conflict',
          error: 'conflict',
          ...(error.currentRevision ? { serverRevision: error.currentRevision } : {}),
        })
      case 'forbidden':
        return this.commitState(doc, {
          ...base,
          state: 'blocked',
          error: 'forbidden',
          access: 'view',
        })
      case 'quota_exceeded':
      case 'not_found':
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

  /** persists the binding, then pushes the status; a failed write still pushes */
  async commitState(doc: BoundDocument, binding: Binding): Promise<BoundDocument> {
    const next: BoundDocument = { ...doc, binding }
    try {
      await this.deps.store.write(doc.dir, binding)
    } catch {
      // the in-memory state is still shown; the next Save writes again
    }
    this.deps.publish(toStatus(next))
    return next
  }
}
