/**
 * AI-generated slide pages (generate_deck / regenerate_slide) landing in a client's session.
 *
 * A page arrives as a marker the host issued for a one-slide pptx: the desktop writes a temp
 * file and issues `cloudpptx:<path>` (slides-main), the web frame keeps the bytes in memory
 * (createGeneratedPageStore). Landing is the same on both: append / replace_at / insert_at land
 * the pages as insertSlidePptx ops (journaled, one undo step), replace makes the assembled pages
 * the new deck. Nothing here writes outside the session; the desktop's draft auto-save of an
 * unbound deck comes in through `draft`.
 */
import {
  autofitGeneratedTextBoxes,
  extractMergeSlideSource,
  mergeSlideFromPptx,
  openPptx,
  promoteSlideBackground,
  savePptx,
  type MergeSlideSource,
} from '@genoffice/pptx-engine'
import { tm } from '../main/i18n-main'
import type { OpenResult } from '../shared/ipc'
import { openResultFor } from './open'
import {
  attachedIds,
  carryHistoryForReplacement,
  markMetaDirty,
  pushHistory,
  scheduleDeckBroadcast,
  sessions,
  type Session,
} from './state'
import { journaledTxn } from './txn'

const GENERATED_PAGE_PREFIX = 'localpptx:'
/** pages a store keeps (a 200-page deck plus its retries); past it the oldest page goes */
const MAX_STORED_PAGES = 256

/** Where a landing reads its pages. The desktop's reader of its temp files answers async and throws its own refusal. */
export interface GeneratedPageSource {
  take(marker: string): Uint8Array | null | Promise<Uint8Array | null>
}

export interface GeneratedPageStore extends GeneratedPageSource {
  /** keep a one-slide pptx; the returned marker redeems it */
  put(bytes: Uint8Array): string
  /**
   * The bytes of a marker this store issued, else null. The page stays redeemable: a landing
   * that failed is retried with the same marker.
   */
  take(marker: string): Uint8Array | null
}

/** In-memory pages of the web frame (the desktop keeps temp files instead). */
export function createGeneratedPageStore(): GeneratedPageStore {
  const pages = new Map<string, Uint8Array>()
  return {
    put(bytes) {
      const marker = GENERATED_PAGE_PREFIX + crypto.randomUUID()
      pages.set(marker, bytes)
      // shortcut: first in, first out (not LRU); fine while one deck's pages stay under the cap
      if (pages.size > MAX_STORED_PAGES) pages.delete(pages.keys().next().value!)
      return marker
    },
    take: (marker) => pages.get(marker) ?? null,
  }
}

export type LandMode = 'replace' | 'append' | 'replace_at' | 'insert_at'

export type LandedPages =
  | (OpenResult & {
      appendedFrom?: number
      replacedIndex?: number
      insertedIndex?: number
      fallbackReason?: string
      imageFailures?: { page: number; url: string }[]
    })
  | { error: string }

/** The desktop's draft auto-save of an unbound deck; each answers whether a draft was written. */
export interface GeneratedPagesDraft {
  /** after an append / replace_at / insert_at landing, with the landed session */
  pages(session: Session): Promise<boolean>
  /** after a replace, with the new session and the assembled deck's bytes */
  deck(session: Session, bytes: Uint8Array): Promise<boolean>
}

/**
 * Land the pages of `markers` in the session of `clientId`. Without `draft` nothing is written
 * outside the document (a UniWork-bound deck, the web frame): the landed pages stay unsaved in
 * the editor and replace keeps the document's path.
 */
export async function landGeneratedPagesInSession(
  clientId: number,
  markers: string[],
  store: GeneratedPageSource,
  fitWidthPx: number,
  mode?: LandMode,
  atIndex?: number,
  draft?: GeneratedPagesDraft,
): Promise<LandedPages> {
  const read = async (marker: string): Promise<Uint8Array> => {
    const bytes = await store.take(marker)
    if (!bytes) throw new Error('unknown generated page marker')
    return bytes
  }
  const settle = async (session: Session): Promise<boolean> => {
    if (draft) return draft.pages(session)
    // merged pages carry no dirty flags of their own: flag the deck so Save and the
    // close guard see the generated pages as unsaved
    markMetaDirty(session)
    return false
  }
  // no draft: no path change for the panel (title, dirty flag): the deck is unsaved
  const landed = (session: Session, drafted: boolean): OpenResult => ({
    ...openResultFor(session, fitWidthPx),
    path: drafted ? session.path : '',
  })

  try {
    // Append: extract only the "new pages" and land them into the existing in-memory
    // deck as one per_op transaction. Already-landed pages stay untouched
    // (O(N) rather than O(N²)); no dependency on stored PageVisualData.
    if (mode === 'append') {
      const existing = sessions.get(clientId)
      if (!existing) return { error: tm('errNoDeckAppend') }
      const beforeCount = existing.opened.deck.slides.length
      // Push an undo snapshot: appending is an ordinary edit, ⌘Z should return to the
      // pre-append state (previously the undoStack was simply cleared, making all of the
      // user's prior manual edits non-undoable — inconsistent with replace_at behavior)
      // Extract every page first (pure reads), then land them as insertSlidePptx ops so
      // the journal and undo see generation like any other edit.
      const sources: MergeSlideSource[] = []
      let lastErr: string | undefined
      for (const marker of markers) {
        try {
          const source = await extractMergeSlideSource(await read(marker))
          if (source) sources.push(source)
          else lastErr = tm('errMergeFailed')
        } catch (pageErr) {
          lastErr = pageErr instanceof Error ? pageErr.message : String(pageErr)
        }
      }
      let merged = 0
      if (sources.length > 0) {
        pushHistory(existing)
        const r = journaledTxn(existing, 'generate', {
          isolation: 'per_op',
          ops: sources.map((source) => ({ op: 'insertSlidePptx', source })),
        })
        merged = r.records?.length ?? 0
        if (merged === 0) existing.undoStack.pop() // Nothing happened, pop the just-pushed snapshot
        if (!lastErr) lastErr = r.failures?.[0]?.error
      }
      if (merged === 0) {
        return { error: tm('errAppendFailed', { reason: lastErr ?? tm('errUnknown') }) }
      }
      existing.fitWidthPx = fitWidthPx
      const drafted = await settle(existing)
      return {
        ...landed(existing, drafted),
        appendedFrom: beforeCount,
        ...(lastErr && merged < markers.length
          ? { fallbackReason: tm('errPartialAppend', { reason: lastErr }) }
          : {}),
      }
    }

    // replace_at redoes one page in place: the insertSlidePptx op merges the extracted page at
    // the end, moves it to atIndex and drops the displaced old page — one atomic txn, one undo
    // snapshot, so ⌘Z rolls back to the old page. insert_at is the same op without dropping an
    // old page (later pages shift back): used to regenerate a failed middle page from
    // generate_deck and put it back in place; atIndex=total lands at the end without a move.
    if (mode === 'replace_at' || mode === 'insert_at') {
      const replace = mode === 'replace_at'
      const existing = sessions.get(clientId)
      if (!existing) return { error: tm(replace ? 'errNoDeckReplace' : 'errNoDeckInsert') }
      const total = existing.opened.deck.slides.length
      const max = replace ? total - 1 : total
      if (atIndex == null || !Number.isInteger(atIndex) || atIndex < 0 || atIndex > max) {
        return { error: tm('errIndexRange', { max }) }
      }
      const marker = markers[0]
      if (!marker || markers.length !== 1) {
        return { error: tm(replace ? 'errReplaceNeedsOne' : 'errInsertNeedsOne') }
      }
      const source = await extractMergeSlideSource(await read(marker))
      if (!source) return { error: tm('errMergeFailed') }
      pushHistory(existing)
      const r = journaledTxn(existing, 'generate', {
        ops: [
          { op: 'insertSlidePptx', source, at: atIndex, ...(replace ? { replace: true } : {}) },
        ],
      })
      if (!r.applied) {
        existing.undoStack.pop() // The executor already restored the deck
        return {
          error: r.failures?.[0]?.error ?? tm(replace ? 'errReplaceFailed' : 'errInsertFailed'),
        }
      }
      existing.fitWidthPx = fitWidthPx
      const drafted = await settle(existing)
      return {
        ...landed(existing, drafted),
        ...(replace ? { replacedIndex: atIndex } : { insertedIndex: atIndex }),
      }
    }

    // replace mode: assemble the whole batch into one multi-page pptx as the new deck base.
    const perPage = await Promise.all(markers.map(read))
    const base = await openPptx(perPage[0]!)
    for (const one of perPage.slice(1)) await mergeSlideFromPptx(base, one)
    for (const s of base.deck.slides) {
      promoteSlideBackground(s, base.deck.size)
      autofitGeneratedTextBoxes(s)
    }
    const bytes = await savePptx(base)
    const replacement: Session = {
      path: '',
      opened: await openPptx(bytes),
      fitWidthPx,
      undoStack: [],
      redoStack: [],
    }
    const old = sessions.get(clientId)
    // Without a draft the new deck keeps its document: it replaces the content of the same
    // working copy and stays unsaved until the user saves
    if (old && !draft) {
      replacement.path = old.path
      markMetaDirty(replacement)
    }
    carryHistoryForReplacement(old, replacement)
    sessions.set(clientId, replacement)
    // Re-point clients that shared the old session, or they diverge onto a dead deck
    if (old) for (const id of attachedIds(old)) sessions.set(id, replacement)
    const drafted = draft ? await draft.deck(replacement, bytes) : false
    scheduleDeckBroadcast(replacement)
    return landed(replacement, drafted)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
