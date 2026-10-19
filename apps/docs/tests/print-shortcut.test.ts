// UNI-1931 (RFF-2, FE1-5/6): the no-document Ctrl/Cmd+P branch App's keydown handler runs: the key is
// swallowed and the "open a document" message is set, but only when the host can print.
import { describe, expect, it, vi } from 'vitest'
import { printDoc, type FileActionContext } from '../src/renderer/file-actions'
import { isNoDocumentPrintKey } from '../src/renderer/print-shortcut'

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { key: 'p', ...init })

describe('isNoDocumentPrintKey', () => {
  it.each([
    ['Ctrl+P', { ctrlKey: true }],
    ['Cmd+P', { metaKey: true }],
  ])('%s with no document and print capability is handled', (_n, init) => {
    expect(isNoDocumentPrintKey(key(init), false, true)).toBe(true)
  })

  it('a document open leaves the shortcut to the menu / browser', () => {
    expect(isNoDocumentPrintKey(key({ ctrlKey: true }), true, true)).toBe(false)
  })

  it('a host without the print capability leaves the key alone', () => {
    expect(isNoDocumentPrintKey(key({ ctrlKey: true }), false, false)).toBe(false)
  })

  it.each([
    ['plain P', {}],
    ['Ctrl+Shift+P', { ctrlKey: true, shiftKey: true }],
    ['Ctrl+Alt+P', { ctrlKey: true, altKey: true }],
  ])('%s is not the print shortcut', (_n, init) => {
    expect(isNoDocumentPrintKey(key(init), false, true)).toBe(false)
  })

  it('another key is not the print shortcut', () => {
    expect(isNoDocumentPrintKey(key({ key: 'o', ctrlKey: true }), false, true)).toBe(false)
  })
})

describe('the keydown branch', () => {
  // App's handler: `if (isNoDocumentPrintKey(e, !!doc, cap('print'))) { preventDefault; printDoc }`
  function press(e: KeyboardEvent, hasDoc: boolean, canPrint: boolean) {
    const setStatus = vi.fn()
    const ctx = { doc: null, setStatus } as unknown as FileActionContext
    if (isNoDocumentPrintKey(e, hasDoc, canPrint)) {
      e.preventDefault()
      printDoc(ctx)
    }
    return setStatus
  }

  it('swallows the key and sets the message with no document', () => {
    const e = key({ ctrlKey: true, cancelable: true })
    const setStatus = press(e, false, true)
    expect(e.defaultPrevented).toBe(true)
    expect(setStatus).toHaveBeenCalledOnce()
  })

  it('leaves the key alone without the print capability', () => {
    const e = key({ ctrlKey: true, cancelable: true })
    const setStatus = press(e, false, false)
    expect(e.defaultPrevented).toBe(false)
    expect(setStatus).not.toHaveBeenCalled()
  })
})
