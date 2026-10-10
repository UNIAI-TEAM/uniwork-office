import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKBOOK_OPEN_STALL_MS,
  bootOpenAction,
  createOpenStallTimer,
} from '../src/renderer/workbook-open-stall'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('opening screen stall timer', () => {
  it('reports an open that is still running after the bound, once', () => {
    const onStall = vi.fn()
    const timer = createOpenStallTimer(onStall)
    timer.start()
    vi.advanceTimersByTime(WORKBOOK_OPEN_STALL_MS - 1)
    expect(onStall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onStall).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(WORKBOOK_OPEN_STALL_MS * 3)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('an open that finishes in time reports nothing', () => {
    const onStall = vi.fn()
    const timer = createOpenStallTimer(onStall, 1000)
    timer.start()
    vi.advanceTimersByTime(999)
    timer.done()
    vi.advanceTimersByTime(10_000)
    expect(onStall).not.toHaveBeenCalled()
  })

  it('a new open re-arms the full bound', () => {
    const onStall = vi.fn()
    const timer = createOpenStallTimer(onStall, 1000)
    timer.start()
    vi.advanceTimersByTime(800)
    timer.start()
    vi.advanceTimersByTime(800)
    expect(onStall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(onStall).toHaveBeenCalledTimes(1)
  })
})

describe('opening screen shown at boot', () => {
  it('pulls a queued workbook', () => {
    expect(bootOpenAction({ queued: true, opening: true, inFlight: false })).toBe('open')
  })

  it('a reloaded tab whose path is gone fails at once instead of waiting forever', () => {
    expect(bootOpenAction({ queued: false, opening: true, inFlight: false })).toBe('stalled')
  })

  it('leaves an open that is already running (the shell nudge) alone', () => {
    expect(bootOpenAction({ queued: false, opening: true, inFlight: true })).toBe('none')
  })

  it('does nothing for a blank tab', () => {
    expect(bootOpenAction({ queued: false, opening: false, inFlight: false })).toBe('none')
  })
})
