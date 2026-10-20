// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkSourceViewChip } from '../src/renderer/src/UniworkSourceViewChip'
import type { SourceViewState } from '../src/shared/source-view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * UNI-1993 (fe-8 item 1): the source chip takes part in the strip's pill fit like the status chip,
 * so a narrow tab strip does not overflow: full label, the short head, the dot alone with the
 * words kept for a screen reader, and the 28px circle. jsdom has no layout: `measurePillFit` is
 * replaced by a model (the width of each variant, the room the strip leaves), the chip's choice of
 * variant and its markup per variant are under test.
 */

const WIDTHS: Record<string, number> = { full: 230, short: 120, compact: 70, mini: 28 }
let budget = 1000

vi.mock('../src/renderer/src/uniwork-pill-fit', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/renderer/src/uniwork-pill-fit')>()
  return {
    ...original,
    measurePillFit: (group: HTMLElement) => ({
      budget,
      natural: WIDTHS[group.getAttribute('data-variant') ?? 'full'] ?? 230,
      toggle: null,
      miniSlack: 0,
      warnRoom: null,
      scale: 1,
    }),
  }
})

let bar: HTMLDivElement
let chrome: HTMLDivElement
let root: Root

beforeEach(() => {
  bar = document.createElement('div')
  const strip = document.createElement('div')
  strip.className = 'tab-strip'
  chrome = document.createElement('div')
  chrome.className = 'uw-chrome'
  bar.append(strip, chrome)
  document.body.append(bar)
  root = createRoot(chrome)
})

afterEach(() => {
  act(() => root.unmount())
  bar.remove()
})

const STATE: SourceViewState = { name: 'Plan.docx', origin: 'chat', parentTitle: 'Standup' }

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkSourceViewChip, { state: STATE }),
      ),
    )
  })
}

const pill = () => chrome.querySelector<HTMLElement>('.uw-pill')!
const FULL = 'View only · From Chat'

describe('UniworkSourceViewChip pill fit', () => {
  it('draws the full label when the strip has room', async () => {
    budget = 1000
    await mount()
    expect(pill().getAttribute('data-variant')).toBe('full')
    expect(pill().querySelector('.uw-pill-label')?.textContent).toBe(FULL)
  })

  it('steps down to the short head ("View only") when the full label does not fit', async () => {
    budget = 150
    await mount()
    expect(pill().getAttribute('data-variant')).toBe('short')
    const label = pill().querySelector('.uw-pill-label')!
    expect(label.querySelector('.uw-sr-only')?.textContent).toBe(FULL)
    expect(label.querySelector('[aria-hidden="true"]')?.textContent).toBe('View only')
  })

  it('then to the dot with the words kept for a screen reader', async () => {
    budget = 100
    await mount()
    expect(pill().getAttribute('data-variant')).toBe('compact')
    const label = pill().querySelector('.uw-pill-label')!
    expect(label.querySelector('.uw-sr-only')?.textContent).toBe(FULL)
    expect(label.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(pill().querySelector('.uw-pill-dot')).not.toBeNull()
  })

  it('and last to the 28px circle, still one named group with the tip', async () => {
    budget = 40
    await mount()
    expect(pill().getAttribute('data-variant')).toBe('mini')
    expect(pill().getAttribute('role')).toBe('group')
    expect(pill().getAttribute('aria-label')).toBe(FULL)
    expect(pill().querySelector('.uw-pill-label .uw-sr-only')?.textContent).toBe(FULL)
    expect(pill().getAttribute('title')).toContain("Changes won't be saved")
    expect(pill().textContent).toContain(FULL)
  })
})
