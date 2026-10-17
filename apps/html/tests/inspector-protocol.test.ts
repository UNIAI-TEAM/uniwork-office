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
    return { dom, messages, setMode, pressEscape }
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
})
