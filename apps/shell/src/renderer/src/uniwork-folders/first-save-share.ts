import { useEffect, useState } from 'react'
import type { UniworkShareApi } from '../../../shared/share-api'
import type { StringKey } from '../locale'

/** the Share dialog's bridge; absent on a stale preload */
function shareBridge(): UniworkShareApi | undefined {
  return (window as unknown as { uniworkShare?: UniworkShareApi }).uniworkShare
}

/** the lists that show a document's row listen for this to read its share scope again */
export const DOC_SHARE_CHANGED_EVENT = 'uniwork:doc-share-changed'

/**
 * The web's first-save share is one `PATCH /documents/{id}` that writes the title and
 * `visibility: "workspace"` together; the app sends it through `renameDocument(..., { shareWithWorkspace })`.
 * Once it went through, the lists that show the document's row are told its share scope changed.
 */
export function announceShared(workspaceId: string, documentId: string): void {
  window.dispatchEvent(
    new CustomEvent(DOC_SHARE_CHANGED_EVENT, { detail: { documentId, workspaceId } }),
  )
}

/** the sentence for a failed first-save share: the app's own for a refusal it already words, else the web's */
export function shareFailureKey(error: string): StringKey {
  switch (error) {
    case 'forbidden':
      return 'uwErrForbidden'
    case 'not_signed_in':
      return 'uwErrNotSignedIn'
    case 'session_expired':
      return 'uwErrSessionExpired'
    case 'my_folder_locked':
      return 'usErrMyFolderLocked'
    case 'folder_not_shareable':
      return 'ufNotShareable'
    default:
      return 'usShareFailed'
  }
}

/**
 * What the share row shows for an existing document (the web gates it on `my_level === 'manage'`
 * and locks it when the document is already shared): `null` while unknown or when the person cannot
 * manage it (no row), else whether the home workspace already holds a grant.
 */
export function useFirstSaveShareState(documentId: string): { alreadyShared: boolean } | null {
  const [state, setState] = useState<{ alreadyShared: boolean } | null>(null)
  useEffect(() => {
    let live = true
    setState(null)
    const bridge = shareBridge()
    if (!bridge) return
    void bridge
      .get(documentId)
      .catch(() => null)
      .then((result) => {
        if (!live || !result?.ok) return
        const access = result.value
        if (access.myLevel !== 'manage') return
        setState({ alreadyShared: access.homeWorkspace?.level != null })
      })
    return () => {
      live = false
    }
  }, [documentId])
  return state
}
