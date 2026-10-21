import { useEffect, useState } from 'react'
import type { ShareErrorCode, UniworkShareApi } from '../../../shared/share-api'
import type { StringKey } from '../locale'

/** a share-API call that failed (the bridge missing counts as `invalid_request`) */
export type FirstSaveShareFailure = { ok: false; error: ShareErrorCode }

/** the Share dialog's bridge; absent on a stale preload */
function shareBridge(): UniworkShareApi | undefined {
  return (window as unknown as { uniworkShare?: UniworkShareApi }).uniworkShare
}

/** the lists that show a document's row listen for this to read its share scope again */
export const DOC_SHARE_CHANGED_EVENT = 'uniwork:doc-share-changed'

/**
 * The web's first-save share, as the app can make it: the web writes the title and
 * `visibility: 'workspace'` in one PATCH; the app has no such PATCH, so the home-workspace row goes
 * in through the Share API (view level, the row the web's PATCH writes) once the document exists.
 * A failure leaves the document as it is.
 */
export async function shareWithWorkspace(
  workspaceId: string,
  documentId: string,
): Promise<{ ok: true } | FirstSaveShareFailure> {
  const bridge = shareBridge()
  if (!bridge) return { ok: false, error: 'invalid_request' }
  const result = await bridge
    .update({
      documentId,
      items: [
        {
          principalType: 'workspace',
          principalId: workspaceId,
          level: 'view',
          onExisting: 'update',
        },
      ],
    })
    .catch((): { ok: false; error: ShareErrorCode } => ({ ok: false, error: 'network' }))
  if (!result.ok) return { ok: false, error: result.error }
  window.dispatchEvent(
    new CustomEvent(DOC_SHARE_CHANGED_EVENT, { detail: { documentId, workspaceId } }),
  )
  return { ok: true }
}

/** the sentence for a failed first-save share: the app's own for a refusal it already words, else the web's */
export function shareFailureKey(error: ShareErrorCode): StringKey {
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
