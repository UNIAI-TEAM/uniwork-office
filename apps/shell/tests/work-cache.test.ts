import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ bucket: 'a-one', cleared: false, active: 'w1' as string | null }))
vi.mock('../src/renderer/src/workbench-bucket', async (orig) => ({
  ...(await orig<typeof import('../src/renderer/src/workbench-bucket')>()),
  currentWorkbenchBucket: () => env.bucket,
  isWorkbenchBucketCleared: () => env.cleared,
}))
vi.mock('../src/renderer/src/active-workspace', async (orig) => ({
  ...(await orig<typeof import('../src/renderer/src/active-workspace')>()),
  readActiveWorkspaceId: () => env.active,
}))

import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import type { WorkTask, WorkTaskStatus } from '../src/shared/uniwork-work-api'
import {
  cacheWork,
  cachedOpenTasks,
  cachedWork,
  settleWork,
  workCacheSlot,
} from '../src/renderer/src/work-cache'

beforeEach(() => {
  env.bucket = 'a-one'
  env.cleared = false
  env.active = 'w1'
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

const task = (id: string, status: string): WorkTask => ({
  id,
  workspace_id: 'w1',
  identifier: '',
  title: id,
  status,
  priority: 'none',
  updated_at: '',
})
const ws = (id: string): UniworkWorkspaceRef => ({
  id,
  name: id,
  orgId: 'o1',
  slug: id,
  orgSlug: 'acme',
})
const SHIPPED: WorkTaskStatus[] = [
  { id: 's', key: 'shipped', name: 'Shipped', category: 'done', color: '', position: 1 },
]

describe('cachedOpenTasks (My AI grounding)', () => {
  it('is null before any load, then the open tasks of the active workspace only', () => {
    env.bucket = 'a-tasks'
    expect(cachedOpenTasks()).toBeNull()
    cacheWork(workCacheSlot('taskStatuses:w1'), SHIPPED)
    cacheWork(workCacheSlot('tasks:w1'), [
      task('open', 'todo'),
      task('d', 'done'),
      task('s', 'shipped'),
    ])
    expect(cachedOpenTasks()?.map((x) => x.id)).toEqual(['open'])
    env.active = 'w2'
    expect(cachedOpenTasks()).toBeNull()
    cacheWork(workCacheSlot('tasks:w2'), [])
    expect(cachedOpenTasks()).toEqual([])
  })

  it('reads the workspace a new task would land in: stored while listed, else the first listed', () => {
    env.bucket = 'a-pick'
    cacheWork(workCacheSlot('tasks:w1'), [task('first', 'todo')])
    env.active = null
    expect(cachedOpenTasks()).toBeNull()
    cacheWork(workCacheSlot('workspaces'), [ws('w1'), ws('w2')])
    expect(cachedOpenTasks()?.map((x) => x.id)).toEqual(['first'])
    env.active = 'gone'
    expect(cachedOpenTasks()?.map((x) => x.id)).toEqual(['first'])
  })
})
