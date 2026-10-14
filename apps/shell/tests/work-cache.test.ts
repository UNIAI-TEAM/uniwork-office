/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
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
  cachedAgendaItems,
  cachedOpenTasks,
  cachedWork,
  settleWork,
  useWorkLoad,
  workCacheSlot,
  type WorkLoad,
} from '../src/renderer/src/work-cache'
import { localIsoDate } from '../src/renderer/src/work-tasks'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

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

describe('useWorkLoad.update', () => {
  it('mirrors an optimistic edit into the cache My AI reads, under the old time', async () => {
    env.bucket = 'a-update'
    let load: WorkLoad<WorkTask[]> | null = null
    const fetch = async () => ({ ok: true as const, value: [task('a', 'todo'), task('b', 'todo')] })
    function Probe() {
      load = useWorkLoad<WorkTask[]>('tasks:w1', fetch)
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Probe)))
    expect(cachedOpenTasks()?.map((x) => x.id)).toEqual(['a', 'b'])
    const at = cachedWork('tasks:w1')?.at
    act(() =>
      load!.update((rows) => rows.map((x) => (x.id === 'a' ? { ...x, status: 'done' } : x))),
    )
    expect(cachedOpenTasks()?.map((x) => x.id)).toEqual(['b'])
    expect(cachedWork('tasks:w1')?.at).toBe(at)
    act(() => root.unmount())
  })
})

describe('cachedAgendaItems (My AI grounding)', () => {
  it('lists the active workspace agenda as the tab shows it (day + title), null before any load', () => {
    env.bucket = 'a-agenda'
    expect(cachedAgendaItems()).toBeNull()
    const today = localIsoDate(new Date())
    cacheWork(workCacheSlot('calendar:w1'), [
      { id: 'e1', kind: 'task', entity_id: 't1', title: 'Send quote', start: today, all_day: true },
      {
        id: 'e2',
        kind: 'meeting',
        entity_id: 'm1',
        title: 'Broken',
        start: 'later',
        all_day: false,
      },
    ])
    expect(cachedAgendaItems()).toEqual([{ date: today, title: 'Send quote' }])
  })
})
