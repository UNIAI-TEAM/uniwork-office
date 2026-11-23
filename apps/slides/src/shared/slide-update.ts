import type { RenderSlide } from '@genoffice/pptx-render'
import type { SlideUpdate } from './ipc'

<<<<<<< ours
/** Merge by stable part identity, including when a full broadcast arrived first. */
export function mergeSlideUpdate(current: RenderSlide[], update: SlideUpdate): RenderSlide[] {
  const byPath = new Map(current.map((slide) => [slide.partPath, slide]))
  for (const slide of update.slides) byPath.set(slide.partPath, slide)
  return update.order.map((path) => {
    const slide = byPath.get(path)
    if (!slide) throw new Error(`Missing slide in render update: ${path}`)
    return slide
  })
}

/** Merge a partial broadcast into `current`, or return `null` when its base deck is unavailable. */
export function mergeBroadcastUpdate(
  current: RenderSlide[] | null,
  update: SlideUpdate,
=======
let refreshDeck: (() => void) | null = null

/** The full-deck refetch a window falls back to when a partial update names slides it has not seen. */
export function setDeckRefresh(refresh: (() => void) | null): void {
  refreshDeck = refresh
}

/** Merge by stable part identity; null when `order` names a slide neither side has. */
export function tryMergeSlideUpdate(
  current: RenderSlide[],
  update: SlideUpdate,
): RenderSlide[] | null {
  const byPath = new Map(current.map((slide) => [slide.partPath, slide]))
  for (const slide of update.slides) byPath.set(slide.partPath, slide)
  if (update.order.some((path) => !byPath.has(path))) return null
  return update.order.map((path) => byPath.get(path)!)
}

/**
 * Merge for state updaters, including when a full broadcast arrived first.
 * In a shared session a reply can name a slide another window added before
 * that window's broadcast reached us; then the deck is kept and refetched
 * instead of thrown away mid-updater.
 */
export function mergeSlideUpdate(current: RenderSlide[], update: SlideUpdate): RenderSlide[] {
  const merged = tryMergeSlideUpdate(current, update)
  if (merged) return merged
  if (!refreshDeck) {
    const known = new Set([...current, ...update.slides].map((slide) => slide.partPath))
    const missing = update.order.find((path) => !known.has(path))
    throw new Error(`Missing slide in render update: ${missing}`)
  }
  queueMicrotask(refreshDeck)
  return current
}

/** A partial broadcast needs a full refresh when its base deck is unavailable. */
export function mergeBroadcastUpdate(
  current: RenderSlide[] | null,
  update: SlideUpdate,
  refresh: () => void,
>>>>>>> theirs
): RenderSlide[] | null {
  const paths = new Set([
    ...(current ?? []).map((slide) => slide.partPath),
    ...update.slides.map((slide) => slide.partPath),
  ])
  if (!current?.length || update.order.some((path) => !paths.has(path))) {
<<<<<<< ours
    return null
  }
  return mergeSlideUpdate(current, update)
}

const MAX_RECOVERY_TRIES = 3

export interface BroadcastRecovery {
  /** Notify recovery state of an incoming broadcast before applying it. */
  onBroadcast(isPartial: boolean): void
  /** Request a single-flight full deck refresh when a partial broadcast lacks a base. */
  requestRefresh(): void
  /** Invalidate any in-flight recovery (document replacement or unmount). */
  invalidate(): void
}

/**
 * Per-consumer recovery state outside the React state updater: at most one full fetch
 * in flight; any broadcast arriving while it is pending marks it stale; on completion,
 * applies the result only if not stale, else retries up to 3 times if a partial update
 * invalidated it (a full broadcast already supplied the full deck).
 */
export function createBroadcastRecovery(
  fetchSlides: () => Promise<RenderSlide[] | null>,
  applySlides: (slides: RenderSlide[]) => void,
  onError?: (error: unknown) => void,
): BroadcastRecovery {
  let inFlight = false
  let pendingRefresh = false
  let stale = false
  let retryOnStale = false
  let tries = 0
  let epoch = 0
  const startFetch = () => {
    if (inFlight || tries >= MAX_RECOVERY_TRIES) return
    inFlight = true
    stale = false
    retryOnStale = false
    tries += 1
    const startedEpoch = epoch
    fetchSlides()
      .then((slides) => {
        if (startedEpoch !== epoch) return
        inFlight = false
        if (!stale) {
          tries = 0
          if (slides) applySlides(slides)
        } else if (retryOnStale && tries < MAX_RECOVERY_TRIES) {
          startFetch()
        } else {
          tries = 0
        }
      })
      .catch((error) => {
        if (startedEpoch !== epoch) return
        inFlight = false
        tries = 0
        onError?.(error)
      })
  }

  return {
    onBroadcast(isPartial: boolean) {
      if (!isPartial) pendingRefresh = false
      if (inFlight) {
        stale = true
        retryOnStale = isPartial
      } else {
        tries = 0
      }
    },
    requestRefresh() {
      const requestedEpoch = epoch
      pendingRefresh = true
      queueMicrotask(() => {
        if (requestedEpoch !== epoch || !pendingRefresh) return
        pendingRefresh = false
        startFetch()
      })
    },
    invalidate() {
      epoch += 1
      pendingRefresh = false
      inFlight = false
      stale = false
      retryOnStale = false
      tries = 0
    },
  }
}
=======
    queueMicrotask(refresh)
    return current
  }
  return mergeSlideUpdate(current, update)
}
>>>>>>> theirs
