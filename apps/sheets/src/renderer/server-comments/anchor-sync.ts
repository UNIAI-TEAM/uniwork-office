/**
 * G8-13 (UNI-1408): the anchor map sent after a Save receipt (addendum §4.3, contract-collab §2.6).
 * Every live anchored root gets one entry: `exact` with the anchor encoded from its live sheet and
 * range, or `lost` with the last anchor the server knows (the server keeps it for a lost comment).
 * `retry_next_save` (the version was not accepted) sends nothing more now: the map is rebuilt from
 * the live locations at the next Save receipt, and the anchors stay shown as stale meanwhile.
 */
import {
  asXlsxAnchor,
  encodeXlsxAnchor,
  locateXlsxAnchor,
  type LiveSheet,
  type ServerAnchorStore,
  type TrackedRoot,
} from './anchor-store'
import {
  sendAnchorMap,
  type AnchorSyncOutcome,
  type CollabAnchorUpdate,
  type CollabSource,
} from './seam'

export function buildAnchorUpdates(
  store: Pick<ServerAnchorStore, 'locationOf'>,
  roots: readonly TrackedRoot[],
  sheets: readonly LiveSheet[],
): CollabAnchorUpdate[] {
  const out: CollabAnchorUpdate[] = []
  for (const root of roots) {
    const last = asXlsxAnchor(root.anchor)
    if (!last || root.deleted) continue
    const tracked = store.locationOf(root.id)
    const at =
      tracked !== undefined
        ? tracked
        : root.anchor_state === 'lost'
          ? null
          : locateXlsxAnchor(sheets, last)
    const sheet = at ? sheets.find((s) => s.id === at.sheetId) : undefined
    out.push(
      at && sheet
        ? { comment_id: root.id, anchor: encodeXlsxAnchor(sheet, at.range), state: 'exact' }
        : { comment_id: root.id, anchor: last, state: 'lost' },
    )
  }
  return out
}

/** send the map for `versionId`; `reload` runs when the server changed at least one row */
export async function syncAnchorsAfterSave(
  source: CollabSource,
  versionId: string,
  updates: CollabAnchorUpdate[],
  reload: () => void,
): Promise<AnchorSyncOutcome> {
  const outcome = await sendAnchorMap(source, versionId, updates)
  // the PUT token is never a since_token (contract §2.6): changed rows -> a full reload
  if (outcome.outcome === 'synced' && outcome.updated.length > 0) reload()
  return outcome
}
