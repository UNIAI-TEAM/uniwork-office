import type {
  UniworkArchiveImpact,
  UniworkCreateFolderInput,
  UniworkDocErrorCode,
  UniworkDocListPage,
  UniworkDocProperties,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkFolderQuery,
  UniworkMoveDocumentInput,
  UniworkMoveResult,
  UniworkResult,
  UniworkSearchPage,
  UniworkSearchQuery,
  UniworkSharedQuery,
  UniworkSourceDownloadInput,
  UniworkTreeChangedEvent,
} from '../../shared/home-api'
import type { UniworkDocShelveResult } from '../../shared/home-api'
import type {
  OpenSourceInput,
  OpenSourceValue,
  SourceViewHint,
  SourceViewResult,
  SourceViewState,
} from '../../shared/source-view'
import type { DocNameError, NewDocFormat } from './uniwork-docs-model'

/**
 * The library reads behind "Shared with me" and the details panel (contract
 * G8-16 §4/§5: uniworkListSharedWithMe, uniworkDocumentProperties). One small
 * module so the bridge names live in one place.
 */

/** a "Shared with me" row: the list spans the organization's workspaces */
export interface SharedDocSummary extends UniworkDocSummary {
  workspaceName?: string
}

export type SharedListQuery = UniworkSharedQuery

export function listSharedDocuments(
  query: SharedListQuery,
): Promise<UniworkResult<UniworkDocListPage>> {
  return window.aiOffice.uniworkListSharedWithMe(query)
}

export function loadDocProperties(
  documentId: string,
): Promise<UniworkResult<UniworkDocProperties>> {
  return window.aiOffice.uniworkDocumentProperties(documentId)
}

// ── Create, rename, archive (S18) ───────────────────────
// Contract G8-17 §1-§3: the shapes below mirror home-api's UniworkDocAction*
// types structurally until the main side merges; then they can be imported.

/**
 * an action's failure: a contract error code, or a name the server refused.
 * 'upload_cancelled' answers an upload the renderer aborted; it is never shown.
 */
export type DocActionError = UniworkDocErrorCode | DocNameError | 'upload_cancelled'

export type DocActionResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: DocActionError
      name?: string
      sizeBytes?: number
      maxBytes?: number
      /** UNI-2047: the server throttled (429 / 503): the same call may be tried once more */
      retryable?: boolean
      /** FD-11: the depth cap of a document_too_deep */ max?: number
      /** UNI-1959: the server has no route for this create (404 / 501): disable that kind */
      endpointMissing?: boolean
    }

export interface CreateDocInput {
  workspaceId: string
  folderId: string | null
  name: string
  format: NewDocFormat
}

/** UNI-1953: a UniNote is a page, created through its own call and opened on the web */
export interface CreatePageInput {
  workspaceId: string
  folderId: string | null
  name: string
}

export interface UploadDocInput {
  workspaceId: string
  folderId: string | null
  /** the file main's dialog returned */
  path: string
  /** minted per upload start: names the upload for progress events and cancel */
  uploadId: string
}

export interface UploadProgressEvent {
  /** the upload this progress belongs to */
  uploadId: string
  path: string
  loaded: number
  total: number
  /** BIGUP-A1: 'checking' while the server verifies a chunked upload; absent = uploading */
  phase?: 'uploading' | 'checking'
}

export interface DocRenamedEvent {
  documentId: string
  title: string
}

interface ActionsBridge {
  uniworkCreateDocument?(input: CreateDocInput): Promise<DocActionResult<UniworkDocSummary>>
  uniworkCreatePage?(input: CreatePageInput): Promise<DocActionResult<UniworkDocSummary>>
  uniworkPickUploadFile?(): Promise<{ path: string; name: string } | null>
  uniworkUploadDocument?(input: UploadDocInput): Promise<DocActionResult<UniworkDocSummary>>
  uniworkCancelUploadDocument?(uploadId: string): Promise<void>
  onUniworkUploadProgress?(cb: (event: UploadProgressEvent) => void): () => void
  uniworkSaveLocalCopy?(path: string): Promise<boolean>
  uniworkRenameDocument?(
    documentId: string,
    name: string,
  ): Promise<DocActionResult<UniworkDocSummary>>
  uniworkArchiveDocument?(documentId: string): Promise<DocActionResult<unknown>>
  uniworkArchiveImpact?(documentId: string): Promise<DocActionResult<UniworkArchiveImpact>>
  uniworkRestoreDocument?(documentId: string): Promise<DocActionResult<unknown>>
  uniworkFolderTree?(workspaceId: string): Promise<UniworkResult<UniworkFolderNode[]>>
  uniworkListChildren?(q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>>
  uniworkSearchDocuments?(q: UniworkSearchQuery): Promise<UniworkResult<UniworkSearchPage>>
  uniworkCreateFolder?(i: UniworkCreateFolderInput): Promise<DocActionResult<UniworkDocSummary>>
  uniworkMoveDocument?(i: UniworkMoveDocumentInput): Promise<DocActionResult<UniworkMoveResult>>
  onUniworkTreeChanged?(cb: (event: UniworkTreeChangedEvent) => void): () => void
  onUniworkDocRenamed?(cb: (event: DocRenamedEvent) => void): () => void
  uniworkDownloadSource?(
    input: UniworkSourceDownloadInput,
  ): Promise<UniworkResult<{ path: string | null }>>
  uniworkOpenSource?(input: OpenSourceInput): Promise<SourceViewResult<OpenSourceValue>>
  uniworkSourceViewState?(path: string): Promise<SourceViewState | null>
  onUniworkSourceViewHint?(cb: (payload: SourceViewHint) => void): () => void
}

const unavailable = { ok: false, error: 'server_error' } as const

function actions(): ActionsBridge {
  return window.aiOffice as unknown as ActionsBridge
}

export function createDocument(input: CreateDocInput): Promise<DocActionResult<UniworkDocSummary>> {
  return actions().uniworkCreateDocument?.(input) ?? Promise.resolve(unavailable)
}

export function createPage(input: CreatePageInput): Promise<DocActionResult<UniworkDocSummary>> {
  return actions().uniworkCreatePage?.(input) ?? Promise.resolve(unavailable)
}

export function pickUploadFile(): Promise<{ path: string; name: string } | null> {
  return actions().uniworkPickUploadFile?.() ?? Promise.resolve(null)
}

export function uploadDocument(input: UploadDocInput): Promise<DocActionResult<UniworkDocSummary>> {
  return actions().uniworkUploadDocument?.(input) ?? Promise.resolve(unavailable)
}

/** abort an upload in flight; an unknown or finished id is a no-op in main */
export function cancelUploadDocument(uploadId: string): Promise<void> {
  return actions().uniworkCancelUploadDocument?.(uploadId) ?? Promise.resolve()
}

export function onUploadProgress(cb: (event: UploadProgressEvent) => void): () => void {
  return actions().onUniworkUploadProgress?.(cb) ?? (() => undefined)
}

export function renameDocument(
  documentId: string,
  name: string,
): Promise<DocActionResult<UniworkDocSummary>> {
  return actions().uniworkRenameDocument?.(documentId, name) ?? Promise.resolve(unavailable)
}

export function archiveDocument(documentId: string): Promise<DocActionResult<unknown>> {
  return actions().uniworkArchiveDocument?.(documentId) ?? Promise.resolve(unavailable)
}

/** UNI-2066: what trashing this folder moves; a missing bridge (an older main) is server_error */
export function getArchiveImpact(
  documentId: string,
): Promise<DocActionResult<UniworkArchiveImpact>> {
  return actions().uniworkArchiveImpact?.(documentId) ?? Promise.resolve(unavailable)
}

export function restoreDocument(documentId: string): Promise<DocActionResult<unknown>> {
  return actions().uniworkRestoreDocument?.(documentId) ?? Promise.resolve(unavailable)
}

// ── Folder tree (FD-11) ─────────────────────────────────
// A missing bridge (an older main) answers server_error and a rejected call
// answers network, like every other read here: the UI shows its error state.

const unavailableRead = { ok: false, error: 'server_error' } as const

function settleRead<T>(call: Promise<UniworkResult<T>> | undefined): Promise<UniworkResult<T>> {
  if (!call) return Promise.resolve(unavailableRead)
  return call.catch((): UniworkResult<T> => ({ ok: false, error: 'network' }))
}

function settleAct<T>(call: Promise<DocActionResult<T>> | undefined): Promise<DocActionResult<T>> {
  if (!call) return Promise.resolve(unavailable)
  return call.catch((): DocActionResult<T> => ({ ok: false, error: 'network' }))
}

/** the workspace's whole folder tree, root nodes first */
export function loadFolderTree(workspaceId: string): Promise<UniworkResult<UniworkFolderNode[]>> {
  return settleRead(actions().uniworkFolderTree?.(workspaceId))
}

/** one folder's contents (folders + files + pages); parentId null = the root */
export function listFolderChildren(
  q: UniworkFolderQuery,
): Promise<UniworkResult<UniworkFolderChildren>> {
  return settleRead(actions().uniworkListChildren?.(q))
}

/** title search across a workspace; hits carry their path */
export function searchDocuments(q: UniworkSearchQuery): Promise<UniworkResult<UniworkSearchPage>> {
  return settleRead(actions().uniworkSearchDocuments?.(q))
}

export function createFolder(
  input: UniworkCreateFolderInput,
): Promise<DocActionResult<UniworkDocSummary>> {
  return settleAct(actions().uniworkCreateFolder?.(input))
}

export function moveDocument(
  input: UniworkMoveDocumentInput,
): Promise<DocActionResult<UniworkMoveResult>> {
  return settleAct(actions().uniworkMoveDocument?.(input))
}

/** UNI-1961: save a Documents-home source file through the save dialog (path null = cancelled) */
export function downloadSource(
  input: UniworkSourceDownloadInput,
): Promise<UniworkResult<{ path: string | null }>> {
  return settleRead(actions().uniworkDownloadSource?.(input))
}

/**
 * UNI-1993: open a source file view only in its editor tab (main downloads it to a temp copy and
 * registers the path as a source view). A bridge that is missing or throws reads as a failure the
 * caller maps to a toast: `server_error` / `network`.
 */
export async function openSource(
  input: OpenSourceInput,
): Promise<SourceViewResult<OpenSourceValue>> {
  const call = actions().uniworkOpenSource?.(input)
  if (!call) return { ok: false, error: 'server_error' }
  try {
    return await call
  } catch {
    return { ok: false, error: 'network' }
  }
}

/** UNI-1993: the tab chip's facts for a path, or null when the path is no source view */
export async function sourceViewStateOf(path: string): Promise<SourceViewState | null> {
  try {
    return (await actions().uniworkSourceViewState?.(path)) ?? null
  } catch {
    return null
  }
}

/** UNI-1993: main says an explicit Save hit a source view path (the tab shows the hint) */
export function onSourceViewHint(cb: (payload: SourceViewHint) => void): () => void {
  return actions().onUniworkSourceViewHint?.(cb) ?? (() => undefined)
}

/** a workspace's tree changed (feed page or an own action, coalesced in main) */
export function onTreeChanged(cb: (event: UniworkTreeChangedEvent) => void): () => void {
  return actions().onUniworkTreeChanged?.(cb) ?? (() => undefined)
}

/** a document was renamed (here or elsewhere): main's push to the window */
export function onDocRenamed(cb: (event: DocRenamedEvent) => void): () => void {
  return actions().onUniworkDocRenamed?.(cb) ?? (() => undefined)
}

/** SIZE-F1: save the bound document's working copy to a user-chosen local path */
export function saveLocalCopy(path: string): Promise<boolean> {
  return actions().uniworkSaveLocalCopy?.(path) ?? Promise.resolve(false)
}

// ── UNI-1961: the Lưu trữ (Archive) shelf ───────────────
// The shelf list itself is read through the Documents home adapter
// (fetchDocumentsHomePage); these are its two row commands.

interface ShelvedBridge {
  uniworkUnshelveDocument?(documentId: string): Promise<DocActionResult<UniworkDocShelveResult>>
  uniworkTrashShelvedDocument?(documentId: string): Promise<DocActionResult<UniworkDocSummary>>
  uniworkShelveDocument?(documentId: string): Promise<DocActionResult<UniworkDocShelveResult>>
}

function shelvedActions(): ShelvedBridge {
  return window.aiOffice as unknown as ShelvedBridge
}

/** Bỏ lưu trữ: the item and its same-batch descendants the caller manages */
export function unshelveDocument(
  documentId: string,
): Promise<DocActionResult<UniworkDocShelveResult>> {
  return settleAct(shelvedActions().uniworkUnshelveDocument?.(documentId))
}

/** Chuyển vào thùng rác from Lưu trữ, for a shelved item of any kind */
export function trashShelvedDocument(
  documentId: string,
): Promise<DocActionResult<UniworkDocSummary>> {
  return settleAct(shelvedActions().uniworkTrashShelvedDocument?.(documentId))
}

/** Lưu trữ a live item from its row (the web's row ⋯ "Lưu trữ") */
export function shelveDocument(
  documentId: string,
): Promise<DocActionResult<UniworkDocShelveResult>> {
  return settleAct(shelvedActions().uniworkShelveDocument?.(documentId))
}

// ── UNI-2047 B6: Gắn sao (Starred) ──────────────────────
// The Starred list is read through the Documents home adapter (fetchDocumentsHomePage); these are
// the two row commands. A host without them (an older shell) has no Gắn sao entry at all.

interface FavoriteBridge {
  uniworkFavoriteDocument?(documentId: string): Promise<DocActionResult<{ favoritedAt: string }>>
  uniworkUnfavoriteDocument?(documentId: string): Promise<DocActionResult<{ documentId: string }>>
}

function favoriteActions(): FavoriteBridge {
  return window.aiOffice as unknown as FavoriteBridge
}

/** whether this shell can star and unstar (both calls present) */
export function canFavoriteDocuments(): boolean {
  const bridge = favoriteActions()
  return (
    typeof bridge?.uniworkFavoriteDocument === 'function' &&
    typeof bridge?.uniworkUnfavoriteDocument === 'function'
  )
}

/** Gắn sao a document from its row (idempotent on the server) */
export function favoriteDocument(
  documentId: string,
): Promise<DocActionResult<{ favoritedAt: string }>> {
  return settleAct(favoriteActions().uniworkFavoriteDocument?.(documentId))
}

/** Bỏ gắn sao a document from its row (idempotent on the server) */
export function unfavoriteDocument(
  documentId: string,
): Promise<DocActionResult<{ documentId: string }>> {
  return settleAct(favoriteActions().uniworkUnfavoriteDocument?.(documentId))
}
