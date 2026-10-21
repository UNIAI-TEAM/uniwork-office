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
 * anchors of the old layout, so `onShift` tells the host which pages moved (shown stale) until a
 * save lands them.
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
  /** the anchored roots the server holds now: a fresh list, so a comment made since the first list is covered */
  roots(): Promise<ReadonlyArray<Pick<CollabComment, 'id' | 'anchor' | 'anchor_state'>>>
  /** the whole map for one version: the kit's `sendAnchorMap` (chunks by 500, `anchor_version_invalid` -> `retry_next_save`); rejects for any other error */
  send(versionId: string, items: CollabAnchorUpdate[]): Promise<AnchorSyncOutcome>
  /** the server changed rows: reload the full list (never reuse the PUT's list_token) */
  onUpdated(): void
  /** a transport failure or an unexpected server error: the shown anchors stay as they are, nothing is retried */
  onError?(error: unknown): void
  /**
   * The server still holds anchors of an older layout than the open file (a send is in flight or
   * was refused with `retry_next_save`, and saves since). `shift` maps a page index of the
   * server's layout to its index in the open file (a missing page was deleted); null when the
   * server's anchors match the open file again. Fires only when this changes.
   */
  onShift?(shift: ReadonlyMap<number, number> | null): void
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
  /** the map of the send in flight: the server answers with the old layout until it lands */
  let inflightMap: Map<number, number> | null = null
  let live = true
  let shown: ReadonlyMap<number, number> | null = null

  /** server layout -> open file: what the saves since the server's anchors took effect changed */
  const publishShift = (): void => {
    if (!live) return
    const base = carriedMap ?? inflightMap
    const next = base ? (pendingMap ? composePageMaps(base, pendingMap) : base) : null
    if (next === null && shown === null) return
    shown = next
    deps.onShift?.(next)
  }

  const flush = (): void => {
    if (!live || pendingMap === null || pendingVersion === null) return
    const map = carriedMap ? composePageMaps(carriedMap, pendingMap) : pendingMap
    const versionId = pendingVersion
    carriedMap = null
    pendingMap = null
    pendingVersion = null
    inflightMap = map
    void (async () => {
      let updated = false
      try {
        const items = remapAnchorsAfterSave(await deps.roots(), map)
        if (!live) return
        if (items.length > 0) {
          const r = await deps.send(versionId, items)
          if (r.outcome === 'retry_next_save') {
            // the shown anchors stay as the server has them; the next Save sends this change again
            if (live) carriedMap = map
          } else {
            updated = r.updated.length > 0
          }
        }
      } catch (error) {
        if (live) deps.onError?.(error)
      }
      inflightMap = null
      publishShift()
      if (live && updated) deps.onUpdated()
    })()
  }

  return {
    saved(pageMap) {
      pendingMap = pendingMap ? composePageMaps(pendingMap, pageMap) : new Map(pageMap)
      publishShift()
      flush()
    },
    receipt(versionId) {
      pendingVersion = versionId
      flush()
    },
    dispose() {
      live = false
      inflightMap = null
      pendingMap = null
      pendingVersion = null
      carriedMap = null
    },
  }
}
