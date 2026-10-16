import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TREE_CHANGED_WINDOW_MS,
  createTreeChangedCoalescer,
} from '../src/main/uniwork-docs/tree-changed'

/**
 * FD-11 (UNI-1809): the coalescer behind `uniwork-doc:tree-changed`. A burst
 * (a folder move plus the feed echo of it, a snapshot's page after page) must
 * reach the renderer once per workspace, and a genuinely later change must
 * still be announced - a window that never reopened would freeze the tree.
 */

afterEach(() => {
  vi.useRealTimers()
})

describe('the tree-changed coalescer', () => {
  it('emits once per workspace per window, however many notices arrive', () => {
    vi.useFakeTimers()
    const emitted: string[] = []
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) => emitted.push(workspaceId),
    })

    coalescer.notify('ws_1')
    coalescer.notify('ws_1')
    vi.advanceTimersByTime(TREE_CHANGED_WINDOW_MS - 1)
    expect(emitted).toEqual([])
    // a notice inside the open window joins it: the window still ends on time
    coalescer.notify('ws_1')
    vi.advanceTimersByTime(1)
    expect(emitted).toEqual(['ws_1'])

    // a change after that window opens a fresh one
    coalescer.notify('ws_1')
    vi.advanceTimersByTime(TREE_CHANGED_WINDOW_MS)
    expect(emitted).toEqual(['ws_1', 'ws_1'])
  })

  it('keeps one window per workspace', () => {
    vi.useFakeTimers()
    const emitted: string[] = []
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) => emitted.push(workspaceId),
    })

    coalescer.notify('ws_1')
    vi.advanceTimersByTime(100)
    coalescer.notify('ws_2')
    vi.advanceTimersByTime(400)
    expect(emitted).toEqual(['ws_1'])
    vi.advanceTimersByTime(100)
    expect(emitted).toEqual(['ws_1', 'ws_2'])
  })

  it('ignores a notice without a workspace and drops pending windows on cancel', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const coalescer = createTreeChangedCoalescer({ emit })

    coalescer.notify('')
    // a caller that could not name a workspace at all (the type says string, so
    // only a deliberate bad input can reach this): nothing is pushed
    coalescer.notify(undefined as unknown as string)
    expect(emit).not.toHaveBeenCalled()

    // a sign-out must not push the pass it stopped
    coalescer.notify('ws_1')
    coalescer.cancel()
    vi.advanceTimersByTime(TREE_CHANGED_WINDOW_MS * 2)
    expect(emit).not.toHaveBeenCalled()

    coalescer.notify('ws_1')
    vi.advanceTimersByTime(TREE_CHANGED_WINDOW_MS)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('ws_1')
  })
})
