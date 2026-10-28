import type { RenderSlide } from '@genoffice/pptx-render'
import type { SlideUpdate } from './ipc'

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

/** A partial broadcast needs a full refresh when its base deck is unavailable. */
export function mergeBroadcastUpdate(
  current: RenderSlide[] | null,
  update: SlideUpdate,
  refresh: () => void,
): RenderSlide[] | null {
  const paths = new Set([
    ...(current ?? []).map((slide) => slide.partPath),
    ...update.slides.map((slide) => slide.partPath),
  ])
  if (!current?.length || update.order.some((path) => !paths.has(path))) {
    queueMicrotask(refresh)
    return current
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
      if (inFlight) {
        stale = true
        retryOnStale = isPartial
      } else {
        tries = 0
      }
    },
    requestRefresh() {
      startFetch()
    },
    invalidate() {
      epoch += 1
      inFlight = false
      stale = false
      retryOnStale = false
      tries = 0
    },
  }
}
