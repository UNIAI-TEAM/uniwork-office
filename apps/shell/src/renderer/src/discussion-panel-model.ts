import { useSyncExternalStore } from 'react'
import type { CollabLevel, CollabSource } from '@genoffice/ui/collab'
import { unwrapCommentsReply } from '@genoffice/electron-utils/comments-reply'
import {
  DISCUSSION_BRIDGE_KEY,
  DISCUSSION_PANEL_LIMITS,
  clampDiscussionPanelWidth,
  type CommentsReply,
  type UniworkDiscussionApi,
} from '@genoffice/electron-utils/comments-ipc'
import type { UniworkDocStatus } from '../../shared/home-api'

/** DOM ids shared by the toggle (tab strip) and the panel frame: `aria-controls` / focus return */
export const DISCUSSION_TOGGLE_ID = 'uw-discussion-toggle'
export const DISCUSSION_PANEL_ID = 'uw-discussion-panel'

export const DISCUSSION_WIDTH_DEFAULT = 360
export const DISCUSSION_WIDTH_STEP = 16
export { DISCUSSION_PANEL_LIMITS, clampDiscussionPanelWidth }

/** the width a person asked for, held to [min, max] before the window decides how much fits */
export function requestedDiscussionWidth(width: number): number {
  if (!Number.isFinite(width)) return DISCUSSION_WIDTH_DEFAULT
  return clampDiscussionPanelWidth(width, Number.MAX_SAFE_INTEGER)
}

/** the typed accessor: null when this build's preload does not expose the bridge (no panel then) */
export function discussionBridge(): UniworkDiscussionApi | null {
  const bridge = (window as unknown as Record<string, UniworkDiscussionApi | undefined>)[
    DISCUSSION_BRIDGE_KEY
  ]
  return bridge ?? null
}

/* ---- open state: the toggle (tab strip) and the panel (app frame) are siblings, not parent and child ---- */

let openState = false
const listeners = new Set<() => void>()

export function setDiscussionOpen(open: boolean): void {
  if (openState === open) return
  openState = open
  for (const listener of [...listeners]) listener()
}

export function useDiscussionOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => openState,
    () => false,
  )
}

/* ---- what the panel is about ---- */

export interface DiscussionTarget {
  path: string
  documentId: string
  level: CollabLevel
}

/**
 * S12 level table input: `view` reads, `edit` writes, manage-like words map to manage. An unknown
 * word never raises access: it reads as `view` (same rule as `commentsLevelOf` in the main process).
 */
export function collabLevelOf(access: string): CollabLevel {
  if (access === 'edit') return 'edit'
  if (access === 'comment') return 'comment'
  if (access === 'manage' || access === 'owner') return 'manage'
  return 'view'
}

/**
 * The document the panel serves: the active tab's UniWork document while signed in. A plain local
 * file (no status), a signed-out desktop or a build without the bridge has no target: no toggle, no panel.
 */
export function discussionTargetOf(
  status: UniworkDocStatus | null,
  signedIn: boolean,
  bridge: UniworkDiscussionApi | null,
): DiscussionTarget | null {
  if (!status || !signedIn || !bridge) return null
  return {
    path: status.path,
    documentId: status.documentId,
    level: status.commentsLevel ?? collabLevelOf(status.access),
  }
}

/* ---- the kit's CollabSource over the bridge ---- */

/**
 * Adapter kit (snake_case) <-> bridge (camelCase). Each call unwraps the reply envelope in this
 * realm, so a failure rejects with the protocol error (`code`, `details.code`, `retryable`) the kit maps.
 */
export function createDiscussionSource(bridge: UniworkDiscussionApi, path: string): CollabSource {
  const value = <T>(reply: Promise<CommentsReply<T>>): Promise<T> =>
    reply.then((r) => unwrapCommentsReply(r))
  return {
    list: (p) =>
      value(bridge.list({ path, ...(p.since_token ? { sinceToken: p.since_token } : {}) })),
    create: (p) =>
      value(
        bridge.create({
          path,
          body: p.body,
          ...(p.parent_id ? { parentId: p.parent_id } : {}),
        }),
      ),
    update: (p) => value(bridge.update({ path, commentId: p.comment_id, body: p.body })),
    remove: (p) => value(bridge.remove({ path, commentId: p.comment_id })),
    resolve: (p) => value(bridge.resolve({ path, commentId: p.comment_id })),
    reopen: (p) => value(bridge.reopen({ path, commentId: p.comment_id })),
    revisions: (p) => value(bridge.revisions({ path, commentId: p.comment_id })),
    searchMentions: (p) =>
      value(
        bridge.searchMentions({
          path,
          q: p.q,
          ...(p.limit !== undefined ? { limit: p.limit } : {}),
        }),
      ),
  }
}

/**
 * Is `commentId` a post or reply of this document's Discussion (tombstones included)? A launch
 * ticket names a comment id without its kind: only a Discussion id opens this panel, anything else
 * belongs to the editor's comment panel.
 */
export async function isDiscussionComment(
  source: CollabSource,
  commentId: string,
): Promise<boolean> {
  try {
    const list = await source.list({ kind: 'discussion' })
    return list.comments.some((c) => c.id === commentId)
  } catch {
    return false
  }
}
