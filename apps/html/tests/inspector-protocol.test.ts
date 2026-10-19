import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { isFromInspector } from '../src/renderer/preview/inspector-protocol'

const here = dirname(fileURLToPath(import.meta.url))
const inspectorSrc = readFileSync(join(here, '../src/renderer/preview/inspector.js'), 'utf8')
describe('isFromInspector', () => {
  it('accepts well-formed inspector messages', () => {
    expect(isFromInspector({ type: 'gx:ready', version: 3, title: 't', docHeight: 10 })).toBe(true)
    expect(isFromInspector({ type: 'gx:zoom', version: 1, delta: 5 })).toBe(true)
  })

  it('rejects forged or malformed shapes', () => {
    expect(isFromInspector(null)).toBe(false)
    expect(isFromInspector('gx:ready')).toBe(false)
    // Unknown tag, even with the gx: prefix.
    expect(isFromInspector({ type: 'gx:evil', version: 1 })).toBe(false)
    // Version is required and numeric (the App matches it against live parse maps).
    expect(isFromInspector({ type: 'gx:ready', title: 't' })).toBe(false)
    expect(isFromInspector({ type: 'gx:ready', version: '3' })).toBe(false)
    expect(isFromInspector({ type: 'gx:ready', version: Number.NaN })).toBe(false)
  })
})

describe('inspector Escape relay in inspect mode (UNI-1876 SVF-5)', () => {
  function makePreview() {
    const messages: Array<Record<string, unknown>> = []
    const hostMessages: Array<(e: { data: Record<string, unknown> }) => void> = []
    const dom = new JSDOM('<!doctype html><html><body><p data-gx-sid="1">Hello</p></body></html>', {
      runScripts: 'dangerously',
    })
    Object.assign(dom.window, {
      // postRect schedules through rAF whenever something is selected; jsdom has
      // none — leaving it queued keeps rect chatter out of the message log
      requestAnimationFrame: () => 0,
      __gxPreviewPort: {
        start: () => {},
        addEventListener: (type: string, fn: (e: { data: Record<string, unknown> }) => void) => {
          if (type === 'message') hostMessages.push(fn)
        },
        postMessage: (msg: Record<string, unknown>) => messages.push(msg),
      },
    })
    dom.window.eval(inspectorSrc.replace('__GX_VERSION__', '1'))
    messages.length = 0
    const send = (msg: Record<string, unknown>) => hostMessages.forEach((fn) => fn({ data: msg }))
    const setMode = (mode: string) =>
      hostMessages.forEach((fn) => fn({ data: { type: 'gx:setMode', mode } }))
    const pressEscape = (init: KeyboardEventInit = {}) =>
      dom.window.document.body.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      )
    return { dom, messages, send, setMode, pressEscape }
  }

  it('relays Escape from the preview iframe when no element is selected and focus is not in a field', () => {
    const { dom, messages } = makePreview()
    const ev = new dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    dom.window.document.body.dispatchEvent(ev)
    expect(messages).toEqual([{ type: 'gx:keyCommand', command: 'escape', version: 1 }])
  })

  it('does not relay Escape autorepeat or IME-composition presses (UNI-1876 RFW4-2)', () => {
    const { messages, setMode, pressEscape } = makePreview()
    pressEscape({ repeat: true })
    pressEscape({ isComposing: true })
    setMode('browse')
    pressEscape({ repeat: true })
    pressEscape({ isComposing: true })
    expect(messages).toEqual([])
    pressEscape()
    expect(messages).toEqual([{ type: 'gx:keyCommand', command: 'escape', version: 1 }])
  })

  it('the first Escape commits an inline text edit, keeping the element selected (SVF2-1 by design)', () => {
    const { dom, messages, send, pressEscape } = makePreview()
    // a click on an element's own text starts an inline edit, so what the
    // tester saw as "selected" was really editing; the first Esc ends that
    // edit (cancel: nothing typed) and only the next Esc clears the selection
    send({ type: 'gx:beginTextEdit', sid: 1 })
    messages.length = 0
    const el = dom.window.document.querySelector('[data-gx-sid="1"]')!
    expect(el.getAttribute('contenteditable')).toBe('plaintext-only')

    pressEscape()
    expect(messages).toEqual([{ type: 'gx:textEditCancel', version: 1 }])
    expect(el.hasAttribute('contenteditable')).toBe(false)

    pressEscape()
    expect(messages).toEqual([
      { type: 'gx:textEditCancel', version: 1 },
      { type: 'gx:keyCommand', command: 'escape', version: 1 },
    ])
  })

  // UNI-1919 (RR2D-4): mod+P inside the preview never reaches the host window; the host claims it
  // with gx:printKey only where its print path runs, else the browser keeps its default
  it('relays mod+P as the print command once the host claims it, even during a text edit', () => {
    const { dom, messages, send } = makePreview()
    const pressP = (init: KeyboardEventInit = {}) => {
      const ev = new dom.window.KeyboardEvent('keydown', {
        key: 'p',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...init,
      })
      dom.window.document.body.dispatchEvent(ev)
      return ev.defaultPrevented
    }
    expect(pressP()).toBe(false)
    expect(messages).toEqual([])

    send({ type: 'gx:printKey', claim: true })
    send({ type: 'gx:beginTextEdit', sid: 1 })
    messages.length = 0
    expect(pressP()).toBe(true)
    expect(pressP({ key: 'P', ctrlKey: false, metaKey: true })).toBe(true)
    expect(messages).toEqual([
      { type: 'gx:keyCommand', command: 'print', version: 1 },
      { type: 'gx:keyCommand', command: 'print', version: 1 },
    ])
    // a held press is suppressed (no second browser dialog beside the module's) but runs nothing
    expect(pressP({ repeat: true })).toBe(true)
    expect(messages).toHaveLength(2)
    // Shift or Alt variants stay the browser's
    expect(pressP({ shiftKey: true })).toBe(false)
    expect(pressP({ altKey: true })).toBe(false)
    expect(messages).toHaveLength(2)

    send({ type: 'gx:printKey', claim: false })
    expect(pressP()).toBe(false)
    expect(messages).toHaveLength(2)
  })

  // UNI-1919 (RC-1): the typed run lives only in the preview DOM; it must reach the host before
  // the print message, or the module serializes the stale text
  it('commits an active inline text edit before the print command', () => {
    const { dom, messages, send } = makePreview()
    send({ type: 'gx:printKey', claim: true })
    send({ type: 'gx:beginTextEdit', sid: 1 })
    const el = dom.window.document.querySelector('[data-gx-sid="1"]')!
    el.firstChild!.textContent = 'Hello typed'
    messages.length = 0
    const ev = new dom.window.KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    dom.window.document.body.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(messages).toEqual([
      { type: 'gx:textEditCommit', sid: 1, textNodeIndex: 0, newText: 'Hello typed', version: 1 },
      { type: 'gx:keyCommand', command: 'print', version: 1 },
    ])
    expect(el.hasAttribute('contenteditable')).toBe(false)
  })
})
