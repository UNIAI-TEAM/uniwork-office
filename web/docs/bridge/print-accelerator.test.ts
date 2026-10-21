// @vitest-environment jsdom
// UNI-1920 item B: the shared Ctrl/Cmd+P accelerator — capture phase, mod+P without
// Shift/Alt, repeat ignored, browser default suppressed only while the print path ran.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installPrintAccelerator } from './print-accelerator'
import { isNoDocumentPrintKey } from '../../../apps/docs/src/renderer/print-shortcut'

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

// UNI-1931 + UNI-1920: in the Docs web frame both the bridge's accelerator (capture phase) and App's
// no-document keydown branch (bubble phase on window) see Ctrl/Cmd+P. Wired as webapi.ts / App.tsx wire
// them, one press must do exactly one thing: the dialog (document), the message (none), or nothing and
// the browser default (no print capability).
describe('Ctrl/Cmd+P in the Docs frame: one handler path (UNI-1931 x UNI-1920)', () => {
  function frame(opts: { hasDoc: boolean; print: boolean }) {
    const actions: string[] = []
    // App's menu 'print' handler -> printDoc: the dialog with a document, the message without
    const printCommand = () => actions.push(opts.hasDoc ? 'dialog' : 'message')
    // webapi.ts: the accelerator runs the menu command only while the print grant is effective
    const offAccelerator = installPrintAccelerator(window, () => {
      if (!opts.print) return false
      printCommand()
      return true
    })
    // App.tsx: the no-document keydown branch
    const onApp = (e: KeyboardEvent) => {
      if (isNoDocumentPrintKey(e, opts.hasDoc, opts.print)) {
        e.preventDefault()
        printCommand()
      }
    }
    window.addEventListener('keydown', onApp)
    off = () => {
      offAccelerator()
      window.removeEventListener('keydown', onApp)
    }
    return actions
  }

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    'a document: one dialog per press (%o)',
    (init) => {
      const actions = frame({ hasDoc: true, print: true })
      const ev = pressP(init)
      expect(actions).toEqual(['dialog'])
      expect(ev.defaultPrevented).toBe(true)
      pressP(init)
      expect(actions).toEqual(['dialog', 'dialog'])
    },
  )

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    'no document: one message per press (%o)',
    (init) => {
      const actions = frame({ hasDoc: false, print: true })
      const ev = pressP(init)
      expect(actions).toEqual(['message'])
      expect(ev.defaultPrevented).toBe(true)
      pressP(init)
      expect(actions).toEqual(['message', 'message'])
    },
  )

  it.each([true, false])(
    'without the print capability nothing runs and the key is not swallowed (doc: %s)',
    (hasDoc) => {
      const actions = frame({ hasDoc, print: false })
      const ev = pressP({ ctrlKey: true })
      expect(actions).toEqual([])
      expect(ev.defaultPrevented).toBe(false)
    },
  )
})
