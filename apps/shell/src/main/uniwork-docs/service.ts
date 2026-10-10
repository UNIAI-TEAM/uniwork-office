import { readFileSync, statSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type {
  RecentUniworkSource,
  UniworkConflictChoice,
  UniworkDocAccess,
  UniworkDocErrorCode,
  UniworkDocFormat,
  UniworkDocListPage,
  UniworkDocListQuery,
  UniworkDocStatus,
  UniworkLaunchEvent,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../../shared/home-api'
import type { DeploymentProfile } from '../uniwork-auth/deployment'
import { callbackSchemeForChannel } from '../uniwork-auth/deployment'
import { type Binding, BindingStore, type BoundDocument, type LastOwner } from './binding-store'
import { type FetchLike, type UniworkDocsClient, createUniworkDocsClient } from './client'
import { UniworkDocError } from './errors'
import { formatForMime, formatForName, sanitizeFilename, sha256Hex } from './formats'
import { LaunchController } from './launch'
import type { DocumentDetail, LaunchDescriptor } from './parse'
import { SaveCoordinator, toStatus } from './save-coordinator'

/**
 * UniWork documents in the shell main process: the picker reads, the open
 * flow (download -> working copy + binding -> the normal module open), the
 * launch bridge, the save coordinator, conflict resolution, the module
 * policy and the recents filter. Electron-free: windows, dialogs, tabs and
 * IPC come in through `deps` (see wiring.ts).
 */

export interface SessionIdentity {
  accountId: string
  deviceSessionId: string
  deploymentId: string
}

/** the native conflict choice (rule 3); the strings live with the dialog */
export interface ConflictUi {
  chooseConflict(title: string): Promise<UniworkConflictChoice>
  confirmDiscard(title: string): Promise<boolean>
  /** Save As for "Save a copy on this computer" (default `<stem> (my copy).<ext>`); null when cancelled */
  pickCopyPath(stem: string, format: UniworkDocFormat): Promise<string | null>
  showOpenLatestFailed(): void
  /** the "Save a copy on this computer" file could not be written */
  showCopyFailed(): void
  /** closing a document whose local changes are not in UniWork yet; `reason` is the binding's error */
  chooseUnsavedClose(
    title: string,
    kind: UnsavedCloseKind,
    reason?: UniworkDocErrorCode,
  ): Promise<UnsavedCloseChoice>
}

/** which close prompt: Save to UniWork, the conflict dialog, or the reason a save is not possible */
export type UnsavedCloseKind = 'unsent' | 'conflict' | 'blocked'

/** 'save' (unsent) and 'resolve' (conflict) are each kind's default button */
export type UnsavedCloseChoice = 'save' | 'resolve' | 'close' | 'cancel'

export interface UniworkDocsServiceDeps {
  userDataDir: string
  profile(): DeploymentProfile | null
  identity(): SessionIdentity | null
  selectedOrgId(): string | null
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  fetch?: FetchLike
  /** the shell's single document router; false = nothing opened */
  openPath(path: string): boolean
  /** a tab or detached window shows this path */
  isPathOpen(path: string): boolean
  /**
   * Runs the owning tab's module Save; false when no tab shows the path.
   * `onNotWritten` is called when the module reports that it did not write
   * (so no user-save hook will follow); modules that cannot tell never call it.
   */
  requestModuleSave(path: string, onNotWritten?: () => void): boolean
  /** remounts the tab showing the path so it re-reads the file */
  reloadPath(path: string): void
  activePath(): string | undefined
  ui: ConflictUi
  pushStatus(status: UniworkDocStatus): void
  pushLaunch(event: UniworkLaunchEvent): void
  reveal(): void
  /** test seam: replaces the HTTP client */
  client?: UniworkDocsClient
  sleep?(ms: number): Promise<void>
  now?(): number
}

/** states whose working copy holds work UniWork does not have yet */
const KEEP_LOCAL_STATES: ReadonlySet<string> = new Set([
  'dirty',
  'conflict',
  'offline',
  'blocked',
  'signed-out',
  'error',
])

/** states whose local bytes are not in UniWork (the close prompt) */
const UNSENT_STATES: ReadonlySet<string> = new Set([
  'dirty',
  'offline',
  'signed-out',
  'error',
  'blocked',
  'conflict',
])

/**
 * How long a close waits for a Save to UniWork to settle before the tab stays
 * open. A module that reports "did not write" ends the wait at once; this cap
 * covers the modules that cannot tell (docs, sheets, slides) and a save that
 * never reaches the user-save hook.
 */
export const CLOSE_SAVE_WAIT_MS = 30_000

async function result<T>(run: () => Promise<T>): Promise<UniworkResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error: error instanceof UniworkDocError ? error.code : 'server_error' }
  }
}

function accessFor(level: string | null): UniworkDocAccess {
  return level === 'edit' || level === 'manage' ? 'edit' : 'view'
}

export class UniworkDocsService {
  readonly store: BindingStore
  readonly coordinator: SaveCoordinator
  readonly launch: LaunchController
  private readonly deps: UniworkDocsServiceDeps
  private client: UniworkDocsClient | null
  private clientOrigin: string | null = null
  private lastOwner: LastOwner | null
  private readonly statusListeners = new Set<(status: UniworkDocStatus) => void>()
  /** path -> checksum of the file as of its mtime/size (the sync close check) */
  private readonly hashMemo = new Map<string, { mtimeMs: number; size: number; checksum: string }>()
  /** working copies whose editor holds edits not written to the file yet */
  private readonly editorDirty = new Set<string>()

  constructor(deps: UniworkDocsServiceDeps) {
    this.deps = deps
    this.client = deps.client ?? null
    this.store = new BindingStore(join(deps.userDataDir, 'uniwork-documents'))
    this.lastOwner = this.store.readLastOwner()
    this.coordinator = new SaveCoordinator({
      store: this.store,
      client: {
        upload: (input) => this.api().upload(input),
        commit: (input) => this.api().commit(input),
        getDocument: (documentId) => this.api().getDocument(documentId),
      },
      isSignedIn: () => deps.identity() !== null,
      ownsBinding: (doc) => this.owns(doc),
      publish: (status) => this.publish(status),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    })
    this.launch = new LaunchController({
      scheme: () => {
        const profile = deps.profile()
        return profile ? callbackSchemeForChannel(profile.channel) : null
      },
      isSignedIn: () => deps.identity() !== null,
      identity: () => deps.identity(),
      profile: () => deps.profile(),
      exchange: (input) => this.api().exchange(input),
      open: (descriptor) => this.openFromServer(descriptor.id, descriptor),
      emit: (event) => deps.pushLaunch(event),
      reveal: () => deps.reveal(),
      ...(deps.now ? { now: deps.now } : {}),
    })
  }

  /** the client for the current profile origin (rebuilt if the origin changes) */
  private api(): UniworkDocsClient {
    if (this.deps.client) return this.deps.client
    const profile = this.deps.profile()
    if (!profile) throw new UniworkDocError('not_signed_in')
    if (!this.client || this.clientOrigin !== profile.apiOrigin) {
      this.client = createUniworkDocsClient({
        apiOrigin: profile.apiOrigin,
        authorized: (call) => this.deps.authorized(call),
        isSignedIn: () => this.deps.identity() !== null,
        ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
      })
      this.clientOrigin = profile.apiOrigin
    }
    return this.client
  }

  /** every status push: the shell window, then in-process waiters (close prompt) */
  private publish(status: UniworkDocStatus): void {
    this.deps.pushStatus(this.present(status))
    for (const listener of [...this.statusListeners]) listener(status)
  }

  /**
   * What the chip shows: the binding's state, except that a clean copy whose
   * editor holds unsaved edits reads dirty. Conflict, offline, signed-out and
   * the rest are never hidden by the editor state.
   */
  private present(status: UniworkDocStatus): UniworkDocStatus {
    const quiet = status.state === 'ready' || status.state === 'saved'
    return quiet && status.access === 'edit' && this.editorDirty.has(status.path)
      ? { ...status, state: 'dirty' }
      : status
  }

  private statusOf(doc: BoundDocument): UniworkDocStatus {
    return this.present(toStatus(doc))
  }

  /**
   * The editor showing `path` has (or no longer has) unsaved edits. Pushes the
   * chip only when that changes what it shows; never writes the binding.
   */
  noteEditorDirty(path: string, dirty: boolean): void {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc) || doc.binding.access !== 'edit') return
    if (dirty === this.editorDirty.has(doc.path)) return
    const before = this.statusOf(doc).state
    if (dirty) this.editorDirty.add(doc.path)
    else this.editorDirty.delete(doc.path)
    const status = this.statusOf(doc)
    if (status.state !== before) this.deps.pushStatus(status)
  }

  /** the live session's identity; remembered (on disk) as the last owner */
  private liveIdentity(): SessionIdentity | null {
    const identity = this.deps.identity()
    if (!identity) return null
    const last = this.lastOwner
    if (
      !last ||
      last.accountId !== identity.accountId ||
      last.deploymentId !== identity.deploymentId
    ) {
      const owner = { accountId: identity.accountId, deploymentId: identity.deploymentId }
      this.lastOwner = owner
      void this.store.writeLastOwner(owner).catch(() => undefined)
    }
    return identity
  }

  /** the session's account may have changed: remember it as the last owner */
  noteSessionIdentity(): void {
    this.liveIdentity()
  }

  /** the binding belongs to the signed-in account and the active deployment */
  owns(doc: BoundDocument): boolean {
    const identity = this.liveIdentity()
    const profile = this.deps.profile()
    return (
      !!identity &&
      !!profile &&
      identity.deploymentId === profile.deploymentId &&
      doc.deploymentId === identity.deploymentId &&
      doc.userId === identity.accountId
    )
  }

  // ---- module policy -------------------------------------------------------

  isBound(path: string): boolean {
    return this.store.lookup(path) !== null
  }

  /**
   * Local ownership, which never depends on the session being live: with a
   * session the copy must be its account's on the active deployment; without
   * one (signed out, expired, restoring) the last signed-in account's copies
   * on the active deployment stay editable and save locally, and only the
   * UniWork step reports signed-out.
   */
  ownsLocally(doc: BoundDocument): boolean {
    if (this.liveIdentity()) return this.owns(doc)
    const last = this.lastOwner
    const profile = this.deps.profile()
    return (
      !!last &&
      !!profile &&
      last.deploymentId === profile.deploymentId &&
      doc.deploymentId === last.deploymentId &&
      doc.userId === last.accountId
    )
  }

  /** view access, or a working copy of another account/deployment */
  isReadOnly(path: string): boolean {
    const doc = this.store.lookup(path)
    return !!doc && (doc.binding.access === 'view' || !this.ownsLocally(doc))
  }

  /** a module's successful explicit user Save of `path` */
  onUserSave(path: string): void {
    const doc = this.store.lookup(path)
    if (!doc || !this.ownsLocally(doc)) return
    // the module just wrote what its editor held
    this.editorDirty.delete(doc.path)
    void this.coordinator.save(path)
  }

  // ---- renderer API ----------------------------------------------------------

  listWorkspaces(): Promise<UniworkResult<UniworkWorkspaceRef[]>> {
    return result(async () => {
      if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
      const orgId = this.deps.selectedOrgId()
      return orgId ? this.api().listWorkspaces(orgId) : []
    })
  }

  listDocuments(query: UniworkDocListQuery): Promise<UniworkResult<UniworkDocListPage>> {
    return result(async () => {
      if (!query || typeof query.workspaceId !== 'string') throw new UniworkDocError('not_found')
      return this.api().listDocuments({
        workspaceId: query.workspaceId,
        ...(typeof query.query === 'string' ? { query: query.query } : {}),
        ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
        ...(typeof query.limit === 'number' ? { limit: query.limit } : {}),
      })
    })
  }

  openDocument(documentId: string): Promise<UniworkResult<{ path: string }>> {
    return result(async () => {
      if (typeof documentId !== 'string') throw new UniworkDocError('not_found')
      const { path } = await this.openFromServer(documentId)
      return { path }
    })
  }

  /** the status, after re-checking the working copy's bytes (A1.3) */
  async docStatus(path: string): Promise<UniworkDocStatus | null> {
    if (typeof path !== 'string') return null
    const doc = this.store.lookup(path)
    return doc && this.ownsLocally(doc) ? this.statusOf(await this.refreshDirty(doc)) : null
  }

  activeDocStatus(): Promise<UniworkDocStatus | null> {
    const path = this.deps.activePath()
    return path ? this.docStatus(path) : Promise.resolve(null)
  }

  /** tab activation: bytes written outside the save hook show as dirty */
  async refreshPath(path: string | undefined): Promise<void> {
    const doc = path ? this.store.lookup(path) : null
    if (doc && this.ownsLocally(doc)) await this.refreshDirty(doc)
  }

  /**
   * Bytes changed with no user-save hook (Save As onto the working copy, an
   * agent save-to, pdf page tools): a ready/saved binding whose file no
   * longer matches the base becomes dirty. Never uploads anything.
   */
  private async refreshDirty(doc: BoundDocument): Promise<BoundDocument> {
    const clean = (b: Binding) =>
      b.access === 'edit' &&
      (b.state === 'ready' || b.state === 'saved') &&
      !b.pendingIntent &&
      !this.coordinator.isSaving(doc.path)
    if (!clean(doc.binding)) return doc
    let checksum: string
    try {
      checksum = sha256Hex(new Uint8Array(await readFile(doc.path)))
    } catch {
      return doc
    }
    if (checksum === doc.binding.baseChecksum) return doc
    // a save may have started or settled while hashing: decide on the latest binding
    const fresh = this.store.lookup(doc.path)
    if (
      !fresh ||
      !clean(fresh.binding) ||
      fresh.binding.baseChecksum !== doc.binding.baseChecksum
    ) {
      return fresh ?? doc
    }
    const next: Binding = { ...fresh.binding, state: 'dirty' }
    delete next.error
    return this.coordinator.commitState(fresh, next)
  }

  /**
   * Save/Retry from the chip. A pending intent is replayed as it is (same key,
   * its own payload) without asking the module to write: a module Save may
   * re-serialize different bytes, which would leave a landed save looking
   * dirty. With no intent it runs the module's own Save.
   */
  async save(path: string): Promise<UniworkDocStatus | null> {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return null
    if (!this.canSave(doc)) return this.statusOf(doc)
    if (!doc.binding.pendingIntent && this.deps.requestModuleSave(doc.path))
      return this.statusOf(doc)
    // a pending intent, or no tab shows it: the file on disk is the user's last saved bytes
    const saved = await this.coordinator.save(doc.path)
    return saved ? this.statusOf(saved) : null
  }

  /** a Save that can reach the UniWork step (not view, conflict, saving or blocked) */
  private canSave(doc: BoundDocument): boolean {
    const b = doc.binding
    if (b.access === 'view' || b.state === 'conflict' || this.coordinator.isSaving(doc.path)) {
      return false
    }
    return !(b.state === 'blocked' && b.error !== 'quota_exceeded')
  }

  // ---- close guard (A1.4) ----------------------------------------------------

  /** synchronous pre-check for the close guards: an editable copy of ours */
  isCloseGuarded(path: string): boolean {
    const doc = this.store.lookup(path)
    return !!doc && doc.binding.access === 'edit' && this.ownsLocally(doc)
  }

  /**
   * Synchronous: would closing `path` show the prompt? An editable copy of ours
   * that is not in `ready`/`saved`, has a pending intent or is saving, or whose
   * file no longer matches the base. A clean copy is false, so a window with
   * only clean documents closes without a prompt chain (see
   * installShellCloseGuard). Hashing is memoized by mtime and size.
   */
  needsClosePrompt(path: string): boolean {
    const doc = this.store.lookup(path)
    if (!doc || doc.binding.access !== 'edit' || !this.ownsLocally(doc)) return false
    const b = doc.binding
    if (b.pendingIntent || this.coordinator.isSaving(doc.path)) return true
    if (b.state !== 'ready' && b.state !== 'saved') return true
    try {
      const { mtimeMs, size } = statSync(doc.path)
      const memo = this.hashMemo.get(doc.path)
      if (memo && memo.mtimeMs === mtimeMs && memo.size === size) {
        return memo.checksum !== b.baseChecksum
      }
      const checksum = sha256Hex(new Uint8Array(readFileSync(doc.path)))
      this.hashMemo.set(doc.path, { mtimeMs, size, checksum })
      return checksum !== b.baseChecksum
    } catch {
      return false
    }
  }

  /**
   * Closing (or quitting) a bound document whose local bytes are not in
   * UniWork: one native prompt. "Save to UniWork" runs the normal Save and
   * allows the close only once it reaches `saved`; in a conflict the default
   * button opens the conflict dialog (as the chip's "Resolve...") and the
   * close goes ahead only if that ends in `saved`; a blocked document has no
   * Save, only its reason. "Close anyway" closes (the copy stays on this
   * computer); "Cancel" keeps it open. True = may close.
   */
  async confirmClose(path: string): Promise<boolean> {
    for (;;) {
      let doc = this.store.lookup(path)
      if (!doc || doc.binding.access !== 'edit' || !this.ownsLocally(doc)) return true
      // a Save from the module's own close prompt may still be uploading
      if (this.coordinator.isSaving(doc.path)) {
        await this.coordinator.settled(doc.path)
        doc = this.store.lookup(path)
        if (!doc) return true
      }
      doc = await this.refreshDirty(doc)
      const b = doc.binding
      if (!b.pendingIntent && !UNSENT_STATES.has(b.state)) return true
      const kind: UnsavedCloseKind =
        b.state === 'conflict'
          ? 'conflict'
          : b.state === 'blocked' && b.error !== 'quota_exceeded'
            ? 'blocked'
            : 'unsent'
      const choice = await this.deps.ui.chooseUnsavedClose(b.title, kind, b.error)
      if (choice === 'close') return true
      if (kind === 'unsent' && choice === 'save') return this.saveForClose(path)
      if (kind === 'conflict' && choice === 'resolve') {
        const outcome = await this.resolveForClose(path)
        if (outcome === 'again') continue
        return outcome === 'closed'
      }
      return false
    }
  }

  /** "Save to UniWork" from the close prompt: true only once the save reached `saved` */
  private async saveForClose(path: string): Promise<boolean> {
    const latest = this.store.lookup(path)
    if (!latest || !this.canSave(latest)) return this.keepOpen(path)
    const wait = this.waitForSettle(latest.path, CLOSE_SAVE_WAIT_MS)
    const notWritten = () => {
      if (!this.coordinator.isSaving(latest.path)) wait.cancel()
    }
    // a pending intent is replayed as it is, the module is not asked to write
    if (latest.binding.pendingIntent || !this.deps.requestModuleSave(latest.path, notWritten)) {
      void this.coordinator.save(latest.path)
    }
    return (await wait.promise)?.state === 'saved' ? true : this.keepOpen(path)
  }

  /**
   * The conflict dialog from the close prompt. 'closed' = the resolution ended
   * in `saved`; 'again' = still in conflict (decide later, a copy, a cancelled
   * discard), so the prompt comes back; 'kept' = anything else (the tab stays).
   */
  private async resolveForClose(path: string): Promise<'closed' | 'again' | 'kept'> {
    // an overwrite saves in the background: dirty and saving are not the end of it
    const wait = this.waitForSettle(path, CLOSE_SAVE_WAIT_MS, new Set(['saving', 'dirty']))
    const notWritten = () => {
      if (!this.coordinator.isSaving(path)) wait.cancel()
    }
    await this.resolveConflict(path, notWritten)
    const after = this.store.lookup(path)
    if (!after || after.binding.state === 'saved') {
      wait.cancel()
      return 'closed'
    }
    if (after.binding.state === 'conflict') {
      wait.cancel()
      return 'again'
    }
    const status = await wait.promise
    if (status?.state === 'saved') return 'closed'
    if (status?.state === 'conflict') return 'again'
    this.keepOpen(path)
    return 'kept'
  }

  /** the tab stays open: publish its state so the chip says why */
  private keepOpen(path: string): false {
    const doc = this.store.lookup(path)
    if (doc) this.publish(toStatus(doc))
    return false
  }

  /**
   * The next status of `path` whose state is not in `ignore` (default: not
   * `saving`); null on timeout or `cancel()`.
   */
  private waitForSettle(
    path: string,
    timeoutMs: number,
    ignore: ReadonlySet<string> = new Set(['saving']),
  ): { promise: Promise<UniworkDocStatus | null>; cancel: () => void } {
    let finish: (status: UniworkDocStatus | null) => void = () => undefined
    const promise = new Promise<UniworkDocStatus | null>((resolveWait) => {
      const listener = (status: UniworkDocStatus) => {
        if (status.path === path && !ignore.has(status.state)) finish(status)
      }
      const timer = setTimeout(() => finish(null), timeoutMs)
      ;(timer as { unref?: () => void }).unref?.()
      finish = (status) => {
        clearTimeout(timer)
        this.statusListeners.delete(listener)
        resolveWait(status)
      }
      this.statusListeners.add(listener)
    })
    return { promise, cancel: () => finish(null) }
  }

  async resolveConflict(path: string, onNotWritten?: () => void): Promise<UniworkDocStatus | null> {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return null
    if (doc.binding.state !== 'conflict') return this.statusOf(doc)
    const choice = await this.deps.ui.chooseConflict(doc.binding.title)
    if (choice === 'overwrite') return this.overwrite(doc, onNotWritten)
    if (choice === 'save-local-copy') {
      const titleExt = extname(doc.binding.title)
      const stem =
        (titleExt ? doc.binding.title.slice(0, -titleExt.length) : doc.binding.title) || 'document'
      const target = await this.deps.ui.pickCopyPath(stem, doc.binding.format)
      // a plain local file; the document itself stays in conflict. A target
      // inside the working-copy folders would not be one (or is the copy itself)
      if (target) {
        const copied =
          !this.store.isInside(target) &&
          (await copyFile(doc.path, target).then(
            () => true,
            () => false,
          ))
        if (!copied) this.deps.ui.showCopyFailed()
      }
      return this.statusOf(doc)
    }
    if (choice === 'open-latest') {
      if (!(await this.deps.ui.confirmDiscard(doc.binding.title))) return this.statusOf(doc)
      try {
        return this.statusOf(await this.replaceWithLatest(doc))
      } catch {
        this.deps.ui.showOpenLatestFailed()
        return this.statusOf(doc)
      }
    }
    return this.statusOf(doc)
  }

  /** recents: null = not a UniWork copy, 'hidden' = another account/deployment */
  recentSource(path: string): RecentUniworkSource | 'hidden' | null {
    const doc = this.store.lookup(path)
    if (!doc) return this.store.isInside(path) ? 'hidden' : null
    if (!this.owns(doc)) return 'hidden'
    const b = doc.binding
    return {
      documentId: b.documentId,
      workspaceId: b.workspaceId,
      title: b.title,
      access: b.access,
    }
  }

  // ---- flows -----------------------------------------------------------------

  /** "Save my version as the newest version": a new intent on the server's revision */
  private async overwrite(
    doc: BoundDocument,
    onNotWritten?: () => void,
  ): Promise<UniworkDocStatus | null> {
    let serverRevision = doc.binding.serverRevision
    if (!serverRevision) {
      try {
        serverRevision = (await this.api().getDocument(doc.binding.documentId)).revision
      } catch (error) {
        const code = error instanceof UniworkDocError ? error.code : 'server_error'
        await this.coordinator.commitState(doc, { ...doc.binding, error: code })
        return this.statusOf(doc)
      }
    }
    const next: Binding = {
      ...doc.binding,
      baseRevision: serverRevision,
      // the server's bytes are unknown here: the next Save always uploads
      baseChecksum: '',
      state: 'dirty',
    }
    delete next.error
    delete next.serverRevision
    delete next.pendingIntent
    const ready = await this.coordinator.commitState(doc, next)
    if (this.deps.requestModuleSave(ready.path, onNotWritten)) return this.statusOf(ready)
    const saved = await this.coordinator.save(ready.path)
    return saved ? this.statusOf(saved) : this.statusOf(ready)
  }

  /** "Discard my changes and open the latest": download, replace, reload the tab */
  private async replaceWithLatest(doc: BoundDocument): Promise<BoundDocument> {
    const { detail, bytes } = await this.fetchLatest(doc.binding.documentId)
    await this.store.writeWorkingCopy(doc.dir, doc.binding.filename, bytes)
    await this.store.dropIntentPayload(doc.dir)
    const next: Binding = {
      ...doc.binding,
      title: detail.title,
      access: accessFor(detail.myLevel),
      baseRevision: detail.revision,
      baseVersion: detail.file.version,
      baseChecksum: sha256Hex(bytes),
      state: 'saved',
    }
    delete next.error
    delete next.serverRevision
    delete next.pendingIntent
    const done = await this.coordinator.commitState(doc, next)
    this.deps.reloadPath(doc.path)
    return done
  }

  /** detail + bytes of the current version, consistent with each other */
  private async fetchLatest(
    documentId: string,
    first?: DocumentDetail,
  ): Promise<{ detail: DocumentDetail; bytes: Uint8Array }> {
    let detail = first ?? (await this.api().getDocument(documentId))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { bytes } = await this.api().download(documentId)
      if (sha256Hex(bytes) === detail.file.checksumSha256) return { detail, bytes }
      // a save landed between the two reads: read the detail again
      detail = await this.api().getDocument(documentId)
    }
    throw new UniworkDocError('malformed_response')
  }

  /** picker, recents reopen and launch: the one open flow */
  async openFromServer(
    documentId: string,
    launch?: LaunchDescriptor,
  ): Promise<{ path: string; title: string }> {
    const identity = this.liveIdentity()
    if (!identity) throw new UniworkDocError('not_signed_in')
    const profile = this.deps.profile()
    if (!profile || profile.deploymentId !== identity.deploymentId) {
      throw new UniworkDocError('wrong_deployment')
    }
    const detail = await this.api().getDocument(documentId)
    const format =
      formatForMime(detail.file.mimeType) ??
      formatForName(detail.file.filename) ??
      formatForName(detail.title)
    if (!format) throw new UniworkDocError('unsupported_format')
    // the web hands off the version it shows, and the server reduces any
    // ticket naming a version to view. While that version is still the
    // current one the launch opens the document itself: the same working
    // copy (and tab) as the picker, with the live ACL. Only an older version
    // is its own view-only copy.
    const historical = !!launch && launch.version > 0 && launch.version !== detail.file.version
    const viewRequested = !!launch && launch.version === 0 && launch.operation === 'view'
    const access: UniworkDocAccess =
      historical || viewRequested ? 'view' : accessFor(detail.myLevel)
    const key = historical ? `${documentId}@v${launch.version}` : documentId
    const dir = this.store.dirFor(identity.deploymentId, identity.accountId, key)
    const existing = await this.store.readDir(dir)
    const workspaceId = launch?.workspaceId ?? detail.workspaceId
    const orgId = launch?.organizationId ?? detail.organizationId

    if (existing && existing.documentId === documentId) {
      const local = join(dir, existing.filename)
      if (this.store.exists(local)) {
        const localChecksum = await readFile(local)
          .then((bytes) => sha256Hex(new Uint8Array(bytes)))
          .catch(() => '')
        const keepLocal =
          !!existing.pendingIntent ||
          KEEP_LOCAL_STATES.has(existing.state) ||
          localChecksum !== existing.baseChecksum ||
          this.deps.isPathOpen(local)
        const current = historical || existing.baseRevision === detail.revision
        if (keepLocal || current) {
          // permissions come from the server: a save refused with 403 left the
          // copy view-only; once the server grants edit again, its local work
          // can be saved (dirty), otherwise it stays view-only
          const binding: Binding = { ...existing, title: detail.title, access }
          if (existing.state === 'blocked' && existing.error === 'forbidden' && access === 'edit') {
            binding.state = 'dirty'
            delete binding.error
          }
          // the document answers again (restored from the trash, a transient
          // 404): its local work can be saved once more
          if (
            existing.state === 'blocked' &&
            (existing.error === 'not_found' || existing.error === 'deleted')
          ) {
            binding.state =
              !existing.pendingIntent && localChecksum === existing.baseChecksum ? 'ready' : 'dirty'
            delete binding.error
          }
          await this.store.write(dir, binding)
          return this.show(local, binding)
        }
      }
    }

    let bytes: Uint8Array
    let base = detail
    if (historical) {
      bytes = (await this.api().download(documentId, launch.version)).bytes
    } else {
      const latest = await this.fetchLatest(documentId, detail)
      bytes = latest.bytes
      base = latest.detail
    }
    const filename =
      existing?.filename ?? sanitizeFilename(detail.file.filename || detail.title, format)
    const path = await this.store.writeWorkingCopy(dir, filename, bytes)
    const binding: Binding = {
      schema: 1,
      documentId,
      workspaceId,
      orgId,
      title: base.title,
      filename,
      format,
      access,
      baseRevision: historical ? launch.revision : base.revision,
      baseVersion: historical ? launch.version : base.file.version,
      baseChecksum: sha256Hex(bytes),
      state: 'ready',
      ...(existing?.lastSavedAt ? { lastSavedAt: existing.lastSavedAt } : {}),
    }
    await this.store.write(dir, binding)
    return this.show(path, binding)
  }

  private show(path: string, binding: Binding): { path: string; title: string } {
    if (!this.deps.openPath(path)) throw new UniworkDocError('unsupported_format')
    const doc = this.store.lookup(path)
    if (doc) this.publish(toStatus(doc))
    return { path, title: binding.title }
  }
}
