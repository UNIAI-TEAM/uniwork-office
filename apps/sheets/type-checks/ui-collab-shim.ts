/**
 * FE13-1 (G8-13): compile-time drift check of the Sheets type shim for the collab kit.
 *
 * `src/types/ui-collab.d.ts` declares the part of `@genoffice/ui/collab` the Sheets server-comment
 * panel uses (the kit's TS source fails this package's stricter compiler options, so tsconfig
 * `paths` points type resolution at the shim). Nothing else ties the two together: a kit signature
 * change would compile clean in Sheets and fail only at runtime. This file is type-checked with the
 * kit's own options (`tsconfig.collab-shim.json`, run by `npm run typecheck`) and fails when they
 * drift:
 * - data shapes: the shim's members and the kit's same members are mutually assignable;
 * - functions and components: the kit's value is assignable to the shim's declaration (every call
 *   Sheets makes through the shim is a valid call of the kit, and what the kit returns satisfies
 *   what Sheets reads).
 */
import type * as Kit from '@genoffice/ui/collab'
import * as KitValues from '@genoffice/ui/collab'
import type * as Shim from '../src/types/ui-collab'

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
/** the shim declares a subset of the kit's members: compare those members both ways */
type SameOn<S, K> = keyof S extends keyof K ? Mutual<S, Pick<K, keyof S & keyof K>> : false
type Assert<T extends true> = T

export type DataShapes = [
  Assert<Mutual<Shim.CollabLevel, Kit.CollabLevel>>,
  Assert<Mutual<Shim.CollabKind, Kit.CollabKind>>,
  Assert<Mutual<Shim.CollabAnchor, Kit.CollabAnchor>>,
  Assert<SameOn<Shim.CollabComment, Kit.CollabComment>>,
  Assert<SameOn<Shim.CollabListResult, Kit.CollabListResult>>,
  Assert<Mutual<Shim.CollabAnchorUpdate, Kit.CollabAnchorUpdate>>,
  Assert<Mutual<Shim.CollabAnchorsResult, Kit.CollabAnchorsResult>>,
  Assert<Mutual<Shim.CollabSource, Kit.CollabSource>>,
  Assert<Mutual<Shim.CollabAnchorAdapter, Kit.CollabAnchorAdapter>>,
  Assert<Mutual<Shim.CollabHostState, Kit.CollabHostState>>,
  Assert<Mutual<Shim.CollabReply<string>, Kit.CollabReply<string>>>,
  Assert<Mutual<Shim.UniworkCommentsLike, Kit.UniworkCommentsLike>>,
  Assert<Mutual<Shim.AnchorSyncOutcome, Kit.AnchorSyncOutcome>>,
  Assert<Mutual<Shim.CollabLoadState, Kit.CollabLoadState>>,
  Assert<SameOn<Shim.CollabThreadView, Kit.CollabThreadView>>,
  Assert<Mutual<Shim.CollabNewThread, Kit.CollabNewThread>>,
  Assert<SameOn<Shim.CollabControllerOptions, Kit.CollabControllerOptions>>,
  Assert<SameOn<Shim.CollabInFileSlot, Kit.CollabInFileSlot>>,
]

// what the kit's controller gives Sheets covers what the shim says Sheets reads
export const controller = (c: Kit.CollabController): Shim.CollabController => c

// values: the kit's runtime export satisfies the shim's declaration
export const values: {
  createUniworkCommentsSource: typeof Shim.createUniworkCommentsSource
  sendAnchorMap: typeof Shim.sendAnchorMap
  useCollabThreads: typeof Shim.useCollabThreads
  CollabPanel: typeof Shim.CollabPanel
  CollabComposer: typeof Shim.CollabComposer
  collabStrings: typeof Shim.collabStrings
  formatCollabTime: typeof Shim.formatCollabTime
  announcePolite: typeof Shim.announcePolite
  COMMENTS_REVEAL_WAIT_MS: typeof Shim.COMMENTS_REVEAL_WAIT_MS
  COLLAB_LIVE_REGION_ID: typeof Shim.COLLAB_LIVE_REGION_ID
} = KitValues
