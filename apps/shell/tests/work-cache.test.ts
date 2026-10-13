import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ bucket: 'a-one', cleared: false }))
vi.mock('../src/renderer/src/workbench-bucket', async (orig) => ({
  ...(await orig<typeof import('../src/renderer/src/workbench-bucket')>()),
  currentWorkbenchBucket: () => env.bucket,
  isWorkbenchBucketCleared: () => env.cleared,
}))

import { cacheWork, cachedWork, settleWork, workCacheSlot } from '../src/renderer/src/work-cache'

beforeEach(() => {
  env.bucket = 'a-one'
  env.cleared = false
})

describe('work cache', () => {
  it('keeps an answer per bucket with its time, and reads null for what was never loaded', () => {
    expect(cachedWork('tasks:w9')).toBeNull()
    cacheWork(workCacheSlot('tasks:w9'), [])
    expect(cachedWork('tasks:w9')?.value).toEqual([])
    expect(typeof cachedWork('tasks:w9')?.at).toBe('number')
    env.bucket = 'a-two'
    expect(cachedWork('tasks:w9')).toBeNull()
  })

  it('a late answer lands in the bucket it was asked from, never in the one shown now', () => {
    const slot = workCacheSlot('home:w1')
    env.bucket = 'a-two' // the account or org changed while the call was in flight
    cacheWork(slot, { n: 1 })
    expect(cachedWork('home:w1')).toBeNull()
    env.bucket = 'a-one'
    expect(cachedWork('home:w1')?.value).toEqual({ n: 1 })
  })

  it('stores and returns nothing while the bucket is cleared', () => {
    const slot = workCacheSlot('tasks:w8')
    env.cleared = true
    expect(workCacheSlot('tasks:w8')).toBeNull()
    cacheWork(slot, [1])
    expect(cachedWork('tasks:w8')).toBeNull()
    env.cleared = false
    expect(cachedWork('tasks:w8')).toBeNull()
  })

  it('a rejected bridge call reads as offline', async () => {
    await expect(settleWork(Promise.reject(new Error('ipc closed')))).resolves.toEqual({
      ok: false,
      error: 'offline',
    })
  })
})
