import { describe, expect, it, vi } from 'vitest'
import type { RenderSlide } from '@genoffice/pptx-render'
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
  it.each([null, [], [slide('other')]])(
    'refreshes when the base is missing: %s',
    async (current) => {
      const refresh = vi.fn()
      expect(
        mergeBroadcastUpdate(
          current,
          { slides: [slide('changed')], order: ['changed', 'missing'] },
          refresh,
        ),
      ).toBe(current)
      await Promise.resolve()
      expect(refresh).toHaveBeenCalledOnce()
    },
  )

  it('merges a complete base without fetching', async () => {
    const refresh = vi.fn()
    const unchanged = slide('unchanged')
    const changed = slide('changed')
    expect(
      mergeBroadcastUpdate(
        [unchanged],
        { slides: [changed], order: ['unchanged', 'changed'] },
        refresh,
      ),
    ).toEqual([unchanged, changed])
    await Promise.resolve()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('coalesces repeated missing-base broadcasts into a single in-flight fetch', async () => {
    let current: RenderSlide[] | null = null
    const d = deferred<RenderSlide[] | null>()
    const fetchSlides = vi.fn(() => d.promise)
    const recovery = createBroadcastRecovery(fetchSlides, (next) => {
      current = next
    })

    current = mergeBroadcastUpdate(
      current,
      { slides: [slide('s1')], order: ['s1', 's2'] },
      recovery.requestRefresh,
    )
    current = mergeBroadcastUpdate(
      current,
      { slides: [slide('s1', 'v2')], order: ['s1', 's2', 's3'] },
      recovery.requestRefresh,
    )
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

    current = mergeBroadcastUpdate(
      current,
      { slides: [slide('s1')], order: ['s1', 's2'] },
      recovery.requestRefresh,
    )
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
    current = mergeBroadcastUpdate(
      current,
      { slides: [slide('s2')], order: ['s1', 's2', 's3'] },
      recovery.requestRefresh,
    )
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
    expect(fetchSlides).toHaveBeenCalledTimes(4)
    recovery.invalidate()
    dUnmount.resolve([slide('replaced')])
    await Promise.resolve()
    await Promise.resolve()
    expect(current).toEqual([slide('s1')])
  })
})
