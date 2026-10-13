import type {
  UniworkDocListPage,
  UniworkDocProperties,
  UniworkDocSummary,
  UniworkResult,
  UniworkSharedQuery,
} from '../../shared/home-api'

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
