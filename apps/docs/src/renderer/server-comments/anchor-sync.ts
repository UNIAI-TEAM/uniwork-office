/**
 * G8-12 (UNI-1407): the anchor map sent after a Save receipt (addendum §4.3, contract-collab §2.6).
 * Every live anchored root gets one entry: `exact` with the anchor re-encoded from its live range, or
 * `lost` with the last anchor the server knows (the server keeps the old anchor for a lost comment).
 * `retry_next_save` (the version was not accepted) sends nothing more now: the map is rebuilt from the
 * live ranges at the next Save receipt.
 */
import { asDocxAnchor } from './anchor-codec'
import type { ServerAnchors, TrackedRoot } from './anchor-tracker'
import {
  sendAnchorMap,
  type AnchorSyncOutcome,
  type CollabAnchorUpdate,
  type CollabSourceWithAnchors,
} from './seam'

export function buildAnchorUpdates(
  anchors: Pick<ServerAnchors, 'rangeOf' | 'encode' | 'locate'>,
  roots: readonly TrackedRoot[],
): CollabAnchorUpdate[] {
  const out: CollabAnchorUpdate[] = []
  for (const root of roots) {
    const last = asDocxAnchor(root.anchor)
    if (!last || root.deleted) continue
    const tracked = anchors.rangeOf(root.id)
    const range = tracked !== undefined ? tracked : anchors.locate(last)
    const fresh = range ? anchors.encode(range) : null
    out.push(
      fresh
        ? { comment_id: root.id, anchor: fresh, state: 'exact' }
        : { comment_id: root.id, anchor: root.anchor!, state: 'lost' },
    )
  }
  return out
}

/** send the map for `versionId`; `reload` runs when the server changed at least one row */
export async function syncAnchorsAfterSave(
  source: CollabSourceWithAnchors,
  versionId: string,
  updates: CollabAnchorUpdate[],
  reload: () => void,
): Promise<AnchorSyncOutcome> {
  const outcome = await sendAnchorMap(source, versionId, updates)
  // the PUT token is never a since_token (contract §2.6): changed rows -> a full reload
  if (outcome.outcome === 'synced' && outcome.updated.length > 0) reload()
  return outcome
}
