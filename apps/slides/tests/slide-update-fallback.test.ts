import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { RenderSlide } from '@genoffice/pptx-render'

vi.mock('react-konva', () => {
  const stub = () => null
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Group: stub,
    Transformer: stub,
    Line: stub,
    Arrow: stub,
    Text: stub,
    Ellipse: stub,
    Image: stub,
    Path: stub,
    Circle: stub,
    Arc: stub,
  }
})
import { AudienceView } from '../src/renderer/components/AudienceView'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { createBroadcastRecovery, mergeBroadcastUpdate } from '../src/shared/slide-update'

const slide = (partPath: string, tag = '') => ({ partPath, tag }) as unknown as RenderSlide

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('partial broadcast fallback', () => {
  it.each([null, [], [slide('other')]])('signals missing base by returning null: %s', (current) => {
    expect(
      mergeBroadcastUpdate(current, {
        slides: [slide('changed')],
        order: ['changed', 'missing'],
      }),
    ).toBeNull()
  })

  it('merges a complete base without fetching', () => {
    const unchanged = slide('unchanged')
    const changed = slide('changed')
    expect(
      mergeBroadcastUpdate([unchanged], {
        slides: [changed],
        order: ['unchanged', 'changed'],
      }),
    ).toEqual([unchanged, changed])
  })

  it('coalesces repeated missing-base broadcasts into a single in-flight fetch', async () => {
    let current: RenderSlide[] | null = null
    const d = deferred<RenderSlide[] | null>()
    const fetchSlides = vi.fn(() => d.promise)
    const recovery = createBroadcastRecovery(fetchSlides, (next) => {
      current = next
    })

    for (const update of [
      { slides: [slide('s1')], order: ['s1', 's2'] },
      { slides: [slide('s1', 'v2')], order: ['s1', 's2', 's3'] },
    ]) {
      recovery.onBroadcast(true)
      const merged = mergeBroadcastUpdate(current, update)
      if (merged) current = merged
      else recovery.requestRefresh()
    }
    expect(current).toBeNull()
    await Promise.resolve()
    expect(fetchSlides).toHaveBeenCalledOnce()
  })

  it('does not overwrite a newer full broadcast when an older fetch resolves', async () => {
    let current: RenderSlide[] | null = null
    const d = deferred<RenderSlide[] | null>()
    const fetchSlides = vi.fn(() => d.promise)
    const recovery = createBroadcastRecovery(fetchSlides, (next) => {
      current = next
    })

    recovery.onBroadcast(true)
    const merged = mergeBroadcastUpdate(current, {
      slides: [slide('s1')],
      order: ['s1', 's2'],
    })
    if (merged) current = merged
    else recovery.requestRefresh()
    expect(current).toBeNull()
    await Promise.resolve()
    expect(fetchSlides).toHaveBeenCalledOnce()

    // A full broadcast arrives while the fetch is still in flight
    recovery.onBroadcast(false)
    const newerDeck = [slide('s1', 'newer'), slide('s2', 'newer')]
    current = newerDeck

    // Older fetch resolves afterwards — must NOT overwrite newerDeck
    d.resolve([slide('s1', 'stale')])
    await Promise.resolve()
    await Promise.resolve()
    expect(current).toBe(newerDeck)
    expect(fetchSlides).toHaveBeenCalledOnce()
  })

  it('retries when a partial broadcast arrives during an in-flight fetch, bounded to 3 attempts, and invalidates on document replacement', async () => {
    let current: RenderSlide[] | null = [slide('s1')]
    const queue = [
      deferred<RenderSlide[] | null>(),
      deferred<RenderSlide[] | null>(),
      deferred<RenderSlide[] | null>(),
      deferred<RenderSlide[] | null>(),
    ]
    let callIdx = 0
    const fetchSlides = vi.fn(() => queue[callIdx++]!.promise)
    const recovery = createBroadcastRecovery(fetchSlides, (next) => {
      current = next
    })

    // Attempt 1 starts on missing base
    recovery.onBroadcast(true)
    const merged = mergeBroadcastUpdate(current, {
      slides: [slide('s2')],
      order: ['s1', 's2', 's3'],
    })
    if (merged) current = merged
    else recovery.requestRefresh()
    await Promise.resolve()
    expect(fetchSlides).toHaveBeenCalledTimes(1)

    // Partial broadcast arrives while attempt 1 is pending -> marks stale -> triggers attempt 2 on completion
    recovery.onBroadcast(true)
    queue[0]!.resolve([slide('s1'), slide('s2')])
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchSlides).toHaveBeenCalledTimes(2)

    // Partial broadcast arrives while attempt 2 is pending -> marks stale -> triggers attempt 3 on completion
    recovery.onBroadcast(true)
    queue[1]!.resolve([slide('s1'), slide('s2')])
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchSlides).toHaveBeenCalledTimes(3)

    // Partial broadcast arrives while attempt 3 is pending -> bounded to 3 tries, gives up and keeps current deck
    recovery.onBroadcast(true)
    queue[2]!.resolve([slide('s1'), slide('s2'), slide('s3')])
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchSlides).toHaveBeenCalledTimes(3)
    expect(current).toEqual([slide('s1')])

    // Document replacement / unmount invalidates in-flight recovery
    const dUnmount = deferred<RenderSlide[] | null>()
    fetchSlides.mockImplementationOnce(() => dUnmount.promise)
    recovery.onBroadcast(true)
    recovery.requestRefresh()
    await Promise.resolve()
    expect(fetchSlides).toHaveBeenCalledTimes(4)
    recovery.invalidate()
    dUnmount.resolve([slide('replaced')])
    await Promise.resolve()
    await Promise.resolve()
    expect(current).toEqual([slide('s1')])
  })

  it('discards a queued refresh when invalidated before the microtask runs and keeps mergeBroadcastUpdate pure (R2-02)', async () => {
    let current: RenderSlide[] | null = null
    let calls = 0
    const fetchSlides = vi.fn(async () => {
      calls += 1
      return [slide('after-invalidate')]
    })
    const recovery = createBroadcastRecovery(fetchSlides, (next) => {
      current = next
    })

    const merged = mergeBroadcastUpdate(current, {
      slides: [slide('a')],
      order: ['a', 'b'],
    })
    expect(merged).toBeNull()
    if (merged) current = merged
    else recovery.requestRefresh()

    recovery.invalidate() // before the queued microtask starts
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toBe(0)
    expect(fetchSlides).not.toHaveBeenCalled()
    expect(current).toBeNull()
  })

  it('does not leave two live recoveries or run invalidated pre-cleanup refreshes across a StrictMode double-effect mount (R2-02)', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const deckListeners = new Set<(payload: { slides: RenderSlide[]; order?: string[] }) => void>()
    const initialLoad = deferred<RenderSlide[] | null>()
    const recoveryLoad = deferred<RenderSlide[] | null>()
    let subscribeCount = 0
    let recoveryFetches = 0
    const getTransition = vi.fn(async () => 'none' as const)

    Object.assign(window, {
      slidesApi: {
        getRenderSlides: vi.fn(() => {
          // First 2 calls are AudienceView's initial tryLoad(0) across StrictMode mount + remount
          if (subscribeCount < 2 || deckListeners.size === 0) return initialLoad.promise
          recoveryFetches += 1
          return recoveryLoad.promise
        }),
        onDeckChanged: vi.fn(
          (cb: (payload: { slides: RenderSlide[]; order?: string[] }) => void) => {
            subscribeCount += 1
            deckListeners.add(cb)
            // During the first StrictMode effect mount (before cleanup), fire a missing-base partial broadcast
            if (subscribeCount === 1) {
              cb({ slides: [slide('s1')], order: ['s1', 's2'] })
            }
            return () => {
              deckListeners.delete(cb)
            }
          },
        ),
        onShowSync: vi.fn(() => () => {}),
        onShowInk: vi.fn(() => () => {}),
        onLanguageChanged: vi.fn(() => () => {}),
        audienceReady: vi.fn(async () => null),
        audienceNav: vi.fn(),
        getTransition,
        getAnimations: vi.fn(async () => []),
        getShapeKeys: vi.fn(async () => []),
      },
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(LocaleProvider, null, createElement(AudienceView)),
        ),
      )
    })

    // StrictMode ran mount -> cleanup -> remount:
    // 1. Only one live onDeckChanged listener remains
    expect(subscribeCount).toBe(2)
    expect(deckListeners.size).toBe(1)
    // 2. The requestRefresh() queued during mount #1 was invalidated by cleanup #1 before its microtask ran -> 0 recovery fetches
    expect(recoveryFetches).toBe(0)

    // 3. A missing-base broadcast after remount triggers exactly 1 recovery fetch from the single live recovery
    await act(async () => {
      for (const l of deckListeners) l({ slides: [slide('s1')], order: ['s1', 's2'] })
      await Promise.resolve()
    })
    expect(recoveryFetches).toBe(1)

    await act(async () => {
      recoveryLoad.resolve([
        { partPath: 's1', nodes: [], widthPx: 960, heightPx: 540 } as unknown as RenderSlide,
        { partPath: 's2', nodes: [], widthPx: 960, heightPx: 540 } as unknown as RenderSlide,
      ])
      await Promise.resolve()
    })
    expect(getTransition).toHaveBeenCalledTimes(2)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
