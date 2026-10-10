/** @vitest-environment jsdom */
// A ribbon band that is wider than its frame (AI panel open at 1440 px, 390 px phones) shows an
// edge cue and a chevron that scrolls the band, instead of cutting a label mid-word.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ribbonOverflowOf, useRibbonCollapse } from '../src/ribbon-collapse'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ribbonOverflowOf', () => {
  const m = (scrollLeft: number, clientWidth = 400, scrollWidth = 900, rtl = false) => ({
    scrollLeft,
    clientWidth,
    scrollWidth,
    rtl,
  })

  it('has no cue when the band fits', () => {
    expect(ribbonOverflowOf(m(0, 900, 900))).toBe('')
    expect(ribbonOverflowOf(m(0, 900, 901))).toBe('')
  })

  it('cues the end at the start of the scroll, both in the middle, the start at the end', () => {
    expect(ribbonOverflowOf(m(0))).toBe('end')
    expect(ribbonOverflowOf(m(200))).toBe('both')
    expect(ribbonOverflowOf(m(500))).toBe('start')
  })

  it('reads the rtl scroll offset (<= 0) as a logical position', () => {
    expect(ribbonOverflowOf(m(0, 400, 900, true))).toBe('end')
    expect(ribbonOverflowOf(m(-200, 400, 900, true))).toBe('both')
    expect(ribbonOverflowOf(m(-500, 400, 900, true))).toBe('start')
  })
})

/** a ribbon that renders only once `ready` is true, like PDF's (after the file has loaded) */
function LateRibbon({ ready }: { ready: boolean }) {
  const collapse = useRibbonCollapse('t.overflow.late', { collapse: 'Collapse', expand: 'Expand' })
  return createElement(
    'div',
    null,
    ready
      ? createElement(
          'div',
          { className: collapse.rootClass, ref: collapse.rootRef },
          createElement('div', { 'data-ribbon-body': '', className: 'ribbon-body' }),
        )
      : null,
  )
}

function Ribbon() {
  const collapse = useRibbonCollapse('t.overflow', { collapse: 'Collapse', expand: 'Expand' })
  return createElement(
    'div',
    { className: collapse.rootClass, ref: collapse.rootRef },
    createElement('div', { className: 'ribbon-tabs' }),
    createElement('div', { 'data-ribbon-body': '', className: 'ribbon-body' }),
  )
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let frameCallbacks: FrameRequestCallback[]

beforeEach(() => {
  localStorage.clear()
  frameCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameCallbacks.push(cb)
    return frameCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const flush = () => {
  const run = frameCallbacks
  frameCallbacks = []
  act(() => run.forEach((cb) => cb(0)))
}

function band(): HTMLElement {
  return host.querySelector<HTMLElement>('[data-ribbon-body]')!
}

function metrics(
  el: HTMLElement,
  v: { clientWidth: number; scrollWidth: number; scrollLeft: number },
) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: v.clientWidth })
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: v.scrollWidth })
  el.scrollLeft = v.scrollLeft
  // jsdom has no layout: a band counts as shown when it reports a client rect
  el.getClientRects = () => [{}] as unknown as DOMRectList
}

const cue = (edge: 'start' | 'end') =>
  host.querySelector<HTMLButtonElement>(`.ribbon-overflow-cue[data-edge="${edge}"]`)

describe('the overflow cue of a ribbon', () => {
  it('stays hidden while the band fits', () => {
    act(() => root.render(createElement(Ribbon)))
    metrics(band(), { clientWidth: 900, scrollWidth: 900, scrollLeft: 0 })
    band().dispatchEvent(new Event('scroll'))
    flush()
    expect(cue('end')?.hidden).toBe(true)
    expect(cue('start')?.hidden).toBe(true)
    expect(host.firstElementChild!.hasAttribute('data-ribbon-overflow')).toBe(false)
  })

  it('shows a chevron at the clipped edge and marks the root', () => {
    act(() => root.render(createElement(Ribbon)))
    metrics(band(), { clientWidth: 400, scrollWidth: 900, scrollLeft: 0 })
    band().dispatchEvent(new Event('scroll'))
    flush()
    expect(cue('end')!.hidden).toBe(false)
    expect(cue('start')!.hidden).toBe(true)
    expect(host.firstElementChild!.getAttribute('data-ribbon-overflow')).toBe('end')
    // the cue is a visual aid: keyboard users already reach every control by Tab
    expect(cue('end')!.getAttribute('aria-hidden')).toBe('true')
    expect(cue('end')!.tabIndex).toBe(-1)
  })

  it('follows the scroll position and scrolls the band when clicked', () => {
    act(() => root.render(createElement(Ribbon)))
    const el = band()
    metrics(el, { clientWidth: 400, scrollWidth: 900, scrollLeft: 200 })
    const scrollBy = vi.fn()
    el.scrollBy = scrollBy as unknown as typeof el.scrollBy
    el.dispatchEvent(new Event('scroll'))
    flush()
    expect(host.firstElementChild!.getAttribute('data-ribbon-overflow')).toBe('both')
    cue('end')!.click()
    expect(scrollBy.mock.calls[0]![0].left).toBeGreaterThan(0)
    cue('start')!.click()
    expect(scrollBy.mock.calls[1]![0].left).toBeLessThan(0)
  })

  it('does not re-schedule itself: its own writes never wake the observers again', async () => {
    act(() => root.render(createElement(Ribbon)))
    metrics(band(), { clientWidth: 400, scrollWidth: 900, scrollLeft: 0 })
    band().dispatchEvent(new Event('scroll'))
    flush()
    // let any MutationObserver records from that update arrive
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(frameCallbacks).toHaveLength(0)
  })

  it('hides the cue while the ribbon is collapsed and removes it on unmount', () => {
    act(() => root.render(createElement(Ribbon)))
    metrics(band(), { clientWidth: 400, scrollWidth: 900, scrollLeft: 0 })
    band().dispatchEvent(new Event('scroll'))
    flush()
    expect(cue('end')!.hidden).toBe(false)
    // collapsed: the band is display:none, so it reports no client rects
    band().getClientRects = () => [] as unknown as DOMRectList
    band().dispatchEvent(new Event('scroll'))
    flush()
    expect(cue('end')!.hidden).toBe(true)
    act(() => root.unmount())
    expect(document.querySelector('.ribbon-overflow-cue')).toBeNull()
    root = createRoot(host)
  })
})

describe('a ribbon that renders after the hook mounted', () => {
  it('gets the cue once it appears (no second mount call in the app)', () => {
    act(() => root.render(createElement(LateRibbon, { ready: false })))
    expect(host.querySelector('.ribbon-overflow-cue')).toBeNull()
    act(() => root.render(createElement(LateRibbon, { ready: true })))
    expect(host.querySelectorAll('.ribbon-overflow-cue')).toHaveLength(2)
    metrics(band(), { clientWidth: 400, scrollWidth: 900, scrollLeft: 0 })
    band().dispatchEvent(new Event('scroll'))
    flush()
    expect(cue('end')!.hidden).toBe(false)
    expect(host.querySelector('[data-ribbon-overflow]')!.getAttribute('data-ribbon-overflow')).toBe(
      'end',
    )
  })

  it('mounts the cue once per ribbon node, not once per render', () => {
    act(() => root.render(createElement(LateRibbon, { ready: true })))
    act(() => root.render(createElement(LateRibbon, { ready: true })))
    act(() => root.render(createElement(LateRibbon, { ready: true })))
    expect(host.querySelectorAll('.ribbon-overflow-cue')).toHaveLength(2)
  })

  it('moves to a replaced ribbon node and cleans up when it goes away', () => {
    act(() => root.render(createElement(LateRibbon, { ready: true })))
    const first = host.querySelector('.ribbon-overflow-cue')
    act(() => root.render(createElement(LateRibbon, { ready: false })))
    expect(host.querySelector('.ribbon-overflow-cue')).toBeNull()
    act(() => root.render(createElement(LateRibbon, { ready: true })))
    const again = host.querySelectorAll('.ribbon-overflow-cue')
    expect(again).toHaveLength(2)
    expect(again[0]).not.toBe(first)
  })
})
