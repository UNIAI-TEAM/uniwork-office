import type {
  UniworkDocErrorCode,
  UniworkDocListPage,
  UniworkDocProperties,
  UniworkDocSummary,
  UniworkResult,
  UniworkSharedQuery,
} from '../../shared/home-api'
import type { FolderChoice } from './UniworkDocActions'
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

export type DocActionResult<T> = { ok: true; value: T } | { ok: false; error: DocActionError }

export interface CreateDocInput {
  workspaceId: string
  folderId: string | null
  name: string
  format: NewDocFormat
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
}

export interface DocRenamedEvent {
  documentId: string
  title: string
}

interface ActionsBridge {
  uniworkCreateDocument?(input: CreateDocInput): Promise<DocActionResult<UniworkDocSummary>>
  uniworkPickUploadFile?(): Promise<{ path: string; name: string } | null>
  uniworkUploadDocument?(input: UploadDocInput): Promise<DocActionResult<UniworkDocSummary>>
  uniworkCancelUploadDocument?(uploadId: string): Promise<void>
  onUniworkUploadProgress?(cb: (event: UploadProgressEvent) => void): () => void
  uniworkRenameDocument?(
    documentId: string,
    name: string,
  ): Promise<DocActionResult<UniworkDocSummary>>
  uniworkArchiveDocument?(documentId: string): Promise<DocActionResult<unknown>>
  uniworkRestoreDocument?(documentId: string): Promise<DocActionResult<unknown>>
  uniworkListFolders?(workspaceId: string): Promise<UniworkResult<FolderChoice[]>>
  onUniworkDocRenamed?(cb: (event: DocRenamedEvent) => void): () => void
}

const unavailable = { ok: false, error: 'server_error' } as const

function actions(): ActionsBridge {
  return window.aiOffice as unknown as ActionsBridge
}

export function createDocument(input: CreateDocInput): Promise<DocActionResult<UniworkDocSummary>> {
  return actions().uniworkCreateDocument?.(input) ?? Promise.resolve(unavailable)
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

export function restoreDocument(documentId: string): Promise<DocActionResult<unknown>> {
  return actions().uniworkRestoreDocument?.(documentId) ?? Promise.resolve(unavailable)
}

/** the workspace's folders for the location field; none when main cannot list them */
export function listFolders(workspaceId: string): Promise<FolderChoice[]> {
  const call = actions().uniworkListFolders?.(workspaceId)
  if (!call) return Promise.resolve([])
  return call.then((r) => (r.ok ? r.value : [])).catch(() => [])
}

/** a document was renamed (here or elsewhere): main's push to the window */
export function onDocRenamed(cb: (event: DocRenamedEvent) => void): () => void {
  return actions().onUniworkDocRenamed?.(cb) ?? (() => undefined)
}
