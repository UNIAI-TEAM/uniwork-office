// @vitest-environment jsdom
// Sheets ribbon tab row at phone width (UNI-1232): tabs scroll sideways and an edge
// fade tells the user there are more; the selected tab is brought into view.
import { afterEach, describe, expect, it } from 'vitest'
import { Fragment, act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { RibbonTabScroller } from '../src/renderer/RibbonTabScroller'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<{ root: Root; container: HTMLElement }> = []
afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

function metrics(el: HTMLElement, m: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: m.scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: m.clientWidth })
}

async function mount(activeKey: string, widths: { scrollWidth: number; clientWidth: number }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const proto = HTMLElement.prototype as unknown as { scrollIntoView?: () => void }
  let scrolledIntoView = 0
  proto.scrollIntoView = () => {
    scrolledIntoView++
  }
  const render = (key: string) =>
    act(async () => {
      root.render(
        createElement(RibbonTabScroller, {
          activeKey: key,
          children: createElement(
            Fragment,
            null,
            createElement('button', { className: 'ribbon-tab active' }, 'Home'),
            createElement('button', { className: 'ribbon-tab' }, 'Insert'),
          ),
        }),
      )
    })
  await render(activeKey)
  roots.push({ root, container })
  const el = container.querySelector<HTMLElement>('.ribbon-tab-scroll')!
  metrics(el, widths)
  return { el, render, scrolled: () => scrolledIntoView }
}

describe('RibbonTabScroller', () => {
  it('shows no fade while every tab fits', async () => {
    const { el } = await mount('home', { scrollWidth: 300, clientWidth: 300 })
    await act(async () => el.dispatchEvent(new Event('scroll')))
    expect(el.hasAttribute('data-fade-end')).toBe(false)
    expect(el.hasAttribute('data-fade-start')).toBe(false)
  })

  it('fades the end while tabs are hidden to the right, the start once scrolled', async () => {
    const { el } = await mount('home', { scrollWidth: 600, clientWidth: 300 })
    await act(async () => el.dispatchEvent(new Event('scroll')))
    expect(el.hasAttribute('data-fade-end')).toBe(true)
    expect(el.hasAttribute('data-fade-start')).toBe(false)
    el.scrollLeft = 100
    await act(async () => el.dispatchEvent(new Event('scroll')))
    expect(el.hasAttribute('data-fade-start')).toBe(true)
    expect(el.hasAttribute('data-fade-end')).toBe(true)
    el.scrollLeft = 300
    await act(async () => el.dispatchEvent(new Event('scroll')))
    expect(el.hasAttribute('data-fade-end')).toBe(false)
    expect(el.hasAttribute('data-fade-start')).toBe(true)
  })

  it('scrolls the selected tab into view when the selection changes', async () => {
    const { render, scrolled } = await mount('home', { scrollWidth: 600, clientWidth: 300 })
    const before = scrolled()
    await render('insert')
    expect(scrolled()).toBeGreaterThan(before)
  })
})
