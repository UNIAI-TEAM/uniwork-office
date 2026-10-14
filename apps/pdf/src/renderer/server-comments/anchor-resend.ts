/**
 * G8-15 (UNI-1410): pairs a Save with its UniWork receipt for the anchor re-send
 * (addendum §4.3, contract §2.6): the renderer knows the new page layout when its
 * own save lands (`saved`, with the page map of that save), the version id only
 * when the shell reports the upload (`receipt`). Whichever comes second sends
 * `comments.anchors` with that version. Two saves before one receipt compose
 * their page maps: the server still holds the anchors of the layout before the
 * first one. A receipt with nothing to pair waits for the next save. When the server
 * does not know the version (`retry_next_save`, the kit's `sendAnchorMap` outcome) the
 * page map is kept and composes with the next save's: the server still holds the
 * anchors of the old layout, and the shown anchors stay as the server has them.
 *
 * Pure: the transport is injected, so the tests drive it without React or IPC.
 */
import type { AnchorSyncOutcome, CollabAnchorUpdate, CollabComment } from '@genoffice/ui/collab'
import { remapAnchorsAfterSave } from './pdf-anchor'

/** a then b: an old page index -> its index after both saves; a page either save dropped is gone */
export function composePageMaps(
  a: ReadonlyMap<number, number>,
  b: ReadonlyMap<number, number>,
): Map<number, number> {
  const out = new Map<number, number>()
  for (const [from, mid] of a) {
    const to = b.get(mid)
    if (to !== undefined) out.set(from, to)
  }
  return out
}

export interface AnchorResendDeps {
  /** the anchored roots the server holds now (the controller's open + resolved threads) */
  roots(): ReadonlyArray<Pick<CollabComment, 'id' | 'anchor' | 'anchor_state'>>
  /** the whole map for one version: the kit's `sendAnchorMap` (chunks by 500, `anchor_version_invalid` -> `retry_next_save`); rejects for any other error */
  send(versionId: string, items: CollabAnchorUpdate[]): Promise<AnchorSyncOutcome>
  /** the server changed rows: reload the full list (never reuse the PUT's list_token) */
  onUpdated(): void
  /** a transport failure or an unexpected server error: the shown anchors stay as they are, nothing is retried */
  onError?(error: unknown): void
}

export interface AnchorResend {
  /** the renderer's save landed; `pageMap`: page index before it -> index in the saved file */
  saved(pageMap: ReadonlyMap<number, number>): void
  /** the shell reported the version this save created */
  receipt(versionId: string): void
  dispose(): void
}

export function createAnchorResend(deps: AnchorResendDeps): AnchorResend {
  let pendingMap: Map<number, number> | null = null
  let pendingVersion: string | null = null
  /** the layout change of a send the server refused (`retry_next_save`): composed into the next one */
  let carriedMap: Map<number, number> | null = null
  let live = true

  const flush = (): void => {
    if (!live || pendingMap === null || pendingVersion === null) return
    const map = carriedMap ? composePageMaps(carriedMap, pendingMap) : pendingMap
    const items = remapAnchorsAfterSave(deps.roots(), map)
    const versionId = pendingVersion
    carriedMap = null
    pendingMap = null
    pendingVersion = null
    if (items.length === 0) return
    void (async () => {
      let updated = false
      try {
        const r = await deps.send(versionId, items)
        if (r.outcome === 'retry_next_save') {
          // the shown anchors stay as the server has them; the next Save sends this change again
          if (live) carriedMap = map
        } else {
          updated = r.updated.length > 0
        }
      } catch (error) {
        if (live) deps.onError?.(error)
      }
      if (live && updated) deps.onUpdated()
    })()
  }

  return {
    saved(pageMap) {
      pendingMap = pendingMap ? composePageMaps(pendingMap, pageMap) : new Map(pageMap)
      flush()
    },
    receipt(versionId) {
      pendingVersion = versionId
      flush()
    },
    dispose() {
      live = false
      pendingMap = null
      pendingVersion = null
      carriedMap = null
    },
  }
}
