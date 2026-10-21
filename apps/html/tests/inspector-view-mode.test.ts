import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const inspectorSrc = readFileSync(join(here, '../src/renderer/preview/inspector.js'), 'utf8')

/** UNI-1993 F2: the `view` mode is for a copy the person may only read */
function makePreview() {
  const messages: Array<Record<string, unknown>> = []
  const hostMessages: Array<(e: { data: Record<string, unknown> }) => void> = []
  const dom = new JSDOM(
    '<!doctype html><html><body><p data-gx-sid="1">Hello</p><a href="https://example.com/">out</a></body></html>',
    { runScripts: 'dangerously' },
  )
  Object.assign(dom.window, {
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
  const setMode = (mode: string) =>
    hostMessages.forEach((fn) => fn({ data: { type: 'gx:setMode', mode } }))
  const click = (el: Element, init: MouseEventInit = {}) => {
    const ev = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    })
    el.dispatchEvent(ev)
    return ev
  }
  const press = (key: string) =>
    dom.window.document.body.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  messages.length = 0
  return { dom, messages, setMode, click, press }
}

describe('inspector view mode', () => {
  it('selects and edits nothing: no selection message, no contenteditable, no key command', () => {
    const { dom, messages, setMode, click, press } = makePreview()
    setMode('view')
    const p = dom.window.document.querySelector('p')!
    click(p)
    press('Delete')
    press('ArrowDown')
    expect(messages.filter((m) => m.type === 'gx:select')).toEqual([])
    expect(messages.filter((m) => m.type === 'gx:keyCommand')).toEqual([])
    expect(p.getAttribute('contenteditable')).toBeNull()
    expect(dom.window.document.querySelector('[contenteditable]')).toBeNull()
  })

  it('keeps links inert, like inspect mode, instead of navigating the frame like browse', () => {
    const { dom, setMode, click } = makePreview()
    const a = dom.window.document.querySelector('a')!
    setMode('browse')
    expect(click(a).defaultPrevented).toBe(false)
    setMode('view')
    expect(click(a).defaultPrevented).toBe(true)
  })

  it('still relays the zoom shortcut to the host', () => {
    const { dom, messages, setMode } = makePreview()
    setMode('view')
    dom.window.document.body.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: '=',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(messages.some((m) => m.type === 'gx:keyCommand' && m.command === 'zoomIn')).toBe(true)
  })
})
