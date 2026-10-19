// @vitest-environment jsdom
// UNI-1920 item B: the shared Ctrl/Cmd+P accelerator — capture phase, mod+P without
// Shift/Alt, repeat ignored, browser default suppressed only while the print path ran.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installPrintAccelerator } from './print-accelerator'

let off: (() => void) | null = null

afterEach(() => {
  off?.()
  off = null
})

function pressP(init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'p', cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('installPrintAccelerator (UNI-1920)', () => {
  it('runs the print path once on Ctrl+P and suppresses the browser default', () => {
    const run = vi.fn(() => true)
    off = installPrintAccelerator(window, run)
    const ev = pressP({ ctrlKey: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
    pressP({ ctrlKey: true })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('runs on Cmd+P (metaKey), not on a bare P', () => {
    const run = vi.fn(() => true)
    off = installPrintAccelerator(window, run)
    pressP({ metaKey: true })
    expect(run).toHaveBeenCalledTimes(1)
    pressP()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('ignores Shift/Alt variants and key auto-repeat', () => {
    const run = vi.fn(() => true)
    off = installPrintAccelerator(window, run)
    pressP({ ctrlKey: true, shiftKey: true })
    pressP({ ctrlKey: true, altKey: true })
    pressP({ metaKey: true, shiftKey: true })
    pressP({ ctrlKey: true, repeat: true })
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps the browser default when the print cap is off (run says it did not run)', () => {
    const run = vi.fn(() => false)
    off = installPrintAccelerator(window, run)
    const ev = pressP({ ctrlKey: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('fires before a bubble-phase listener (capture) and stops running once uninstalled', () => {
    const order: string[] = []
    off = installPrintAccelerator(window, () => (order.push('accelerator'), true))
    window.addEventListener('keydown', () => order.push('bubble'), false)
    pressP({ ctrlKey: true })
    expect(order).toEqual(['accelerator', 'bubble'])
    off()
    off = null
    const run = vi.fn(() => true)
    off = installPrintAccelerator(window, run)
    off()
    off = null
    pressP({ ctrlKey: true })
    expect(run).not.toHaveBeenCalled()
  })
})
