import type { UniworkWorkspaceRef } from '../../../shared/home-api'
import { pageWebTarget } from '../uniwork-page-web'

/**
 * Copy link of a row: the document's UniWork web page (main builds the URL
 * from the slugs, the renderer never forms one). false = nothing was copied:
 * unknown workspace slugs, no URL from main, or the clipboard refused.
 */
export async function copyDocLink(
  workspaces: readonly UniworkWorkspaceRef[],
  workspaceId: string,
  documentId: string,
): Promise<boolean> {
  const target = pageWebTarget(workspaces, workspaceId, documentId)
  if (!target) return false
  try {
    const url = await window.uniworkWork.webUrl(target)
    if (!url) return false
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}
