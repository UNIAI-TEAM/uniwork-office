import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { WorkWebTarget } from '../../shared/uniwork-work-api'

/**
 * UNI-1953: the app has no UniNote editor, so a page (created or listed) opens
 * as its UniWork web page, in the system browser through main's `openWeb`
 * (main builds the URL from these slugs; the renderer never passes one).
 */

/** the web target of one page, or null when its workspace's slugs are not known */
export function pageWebTarget(
  workspaces: readonly UniworkWorkspaceRef[],
  workspaceId: string,
  documentId: string,
): WorkWebTarget | null {
  const ws = workspaces.find((w) => w.id === workspaceId)
  if (!ws?.slug || !ws.orgSlug) return null
  return { kind: 'document', orgSlug: ws.orgSlug, wsSlug: ws.slug, id: documentId }
}

/** true when the system browser was asked to open the page; false is the caller's open failure */
export async function openPageOnWeb(
  workspaces: readonly UniworkWorkspaceRef[],
  workspaceId: string,
  documentId: string,
): Promise<boolean> {
  const target = pageWebTarget(workspaces, workspaceId, documentId)
  if (!target) return false
  try {
    return await window.uniworkWork.openWeb(target)
  } catch {
    return false
  }
}
