import type { UniworkDocListPage, UniworkDocSummary, UniworkResult } from '../../shared/home-api'
import type { DocInfoFields } from './uniwork-docs-model'

/**
 * The library reads added for "Shared with me" and the details panel. Kept
 * behind one small module so the bridge names of the IPC contract live in
 * one place; a main build without them answers like a server that cannot
 * serve the request (the picker shows its error state, nothing crashes).
 */

/** a "Shared with me" row: the list spans the organization's workspaces */
export interface SharedDocSummary extends UniworkDocSummary {
  workspaceName?: string
}

export interface SharedListQuery {
  /** the workspace the person is in (the server reads the shared list in its organization) */
  workspaceId: string
  cursor?: string
  limit?: number
}

interface LibraryBridge {
  uniworkListShared?(query: SharedListQuery): Promise<UniworkResult<UniworkDocListPage>>
  uniworkDocProperties?(documentId: string): Promise<UniworkResult<DocInfoFields>>
}

const unavailable = { ok: false, error: 'server_error' } as const

function bridge(): LibraryBridge {
  return window.aiOffice as unknown as LibraryBridge
}

export function listSharedDocuments(
  query: SharedListQuery,
): Promise<UniworkResult<UniworkDocListPage>> {
  return bridge().uniworkListShared?.(query) ?? Promise.resolve(unavailable)
}

export function loadDocProperties(documentId: string): Promise<UniworkResult<DocInfoFields>> {
  return bridge().uniworkDocProperties?.(documentId) ?? Promise.resolve(unavailable)
}
