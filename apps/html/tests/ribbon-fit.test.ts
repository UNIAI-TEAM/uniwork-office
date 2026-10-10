import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { MAX_FIT_LEVEL, nextFitLevel } from '../src/renderer/components/ribbon-fit'

vi.mock('../src/renderer/ai/AiPanel', () => ({ GensparkMark: () => null }))

describe('nextFitLevel', () => {
  it('steps while the band overflows, stops when it fits or at the last level', () => {
    expect(nextFitLevel(0, { scrollWidth: 1300, clientWidth: 1100 })).toBe(1)
    expect(nextFitLevel(1, { scrollWidth: 1200, clientWidth: 1100 })).toBe(2)
    expect(nextFitLevel(MAX_FIT_LEVEL, { scrollWidth: 2000, clientWidth: 1100 })).toBe(
      MAX_FIT_LEVEL,
    )
    expect(nextFitLevel(0, { scrollWidth: 1100, clientWidth: 1100 })).toBe(0)
    // a 1 px rounding difference is not an overflow
    expect(nextFitLevel(0, { scrollWidth: 1101, clientWidth: 1100 })).toBe(0)
  })
})

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** layout is absent in jsdom: the band is `needs[level]` px wide in a 1100 px slot */
function fakeLayout(needs: [number, number, number]) {
  const level = (el: HTMLElement) => Number(el.dataset.fit ?? 0)
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute('data-ribbon-body') ? needs[level(this)]! : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute('data-ribbon-body') ? 1100 : 0
  })
}

function renderRibbon() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const noop = vi.fn()
  act(() =>
    root.render(
      createElement(Ribbon, {
        disabled: false,
        dirty: false,
        onSave: noop,
        onSaveAs: noop,
        onFind: noop,
        autoSave: false,
        onToggleAutoSave: noop,
        aiOpen: false,
        onToggleAi: noop,
        onAiPreset: noop,
        canUndo: false,
        canRedo: false,
        onUndo: noop,
        onRedo: noop,
        view: 'preview',
        onView: noop,
        canInsert: true,
        onInsert: noop,
        canvasMode: 'edit',
        onPresent: noop,
      }),
    ),
  )
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container.querySelector<HTMLElement>('[data-ribbon-body]')!
}

describe('Ribbon fit', () => {
  it('keeps every label when the band fits', () => {
    fakeLayout([1000, 900, 800])
    expect(renderRibbon().dataset.fit).toBe('0')
  })

  it('goes icon-only in the Insert row first', () => {
    fakeLayout([1300, 1050, 800])
    expect(renderRibbon().dataset.fit).toBe('1')
  })

  it('goes icon-only everywhere when that is still not enough, keeping Present reachable', () => {
    fakeLayout([1500, 1300, 1000])
    const body = renderRibbon()
    expect(body.dataset.fit).toBe('2')
    // the clipped label keeps the accessible name of the Present command
    const present = [...body.querySelectorAll('button')].find(
      (b) => b.hasAttribute('aria-haspopup') && b.textContent?.length,
    )
    expect(present?.textContent).toBeTruthy()
  })
})
