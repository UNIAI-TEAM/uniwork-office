/**
 * G8-15 (UNI-1410): pairs a Save with its UniWork receipt for the anchor re-send
 * (addendum §4.3, contract §2.6): the renderer knows the new page layout when its
 * own save lands (`saved`, with the page map of that save), the version id only
 * when the shell reports the upload (`receipt`). Whichever comes second sends
 * `comments.anchors` with that version. Two saves before one receipt compose
 * their page maps: the server still holds the anchors of the layout before the
 * first one. A receipt with nothing to pair waits for the next save.
 *
 * Pure: the transport is injected, so the tests drive it without React or IPC.
 */
import { chunkAnchors, remapAnchorsAfterSave, type AnchorRemapItem } from './pdf-anchor'
import type { CollabComment } from '@genoffice/ui/collab'

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
  /** one `comments.anchors` call; rejects with the protocol error */
  send(versionId: string, items: AnchorRemapItem[]): Promise<{ updated: string[] }>
  /** the server changed rows: reload the full list (never reuse the PUT's list_token) */
  onUpdated(): void
  /** `anchor_version_invalid` or a transport failure: the shown anchors stay `stale`, the next Save retries */
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
  let live = true

  const flush = (): void => {
    if (!live || pendingMap === null || pendingVersion === null) return
    const items: AnchorRemapItem[] = remapAnchorsAfterSave(deps.roots(), pendingMap)
    const versionId = pendingVersion
    pendingMap = null
    pendingVersion = null
    if (items.length === 0) return
    void (async () => {
      let updated = false
      try {
        for (const chunk of chunkAnchors(items)) {
          const r = await deps.send(versionId, chunk)
          if (r.updated.length > 0) updated = true
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
    },
  }
}
