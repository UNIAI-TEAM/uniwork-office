/** @vitest-environment jsdom */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskUniCitation } from '@genoffice/ai-provider/askuni'
import { AskUniAdapterProvider, AskUniTurn, type AskUniTurnMessage } from '../src/ask-uni'
import { fakeAdapter, type FakeAdapter } from './ask-uni-kit'

// UNI-2116 polish: the hover card is a preview that never blocks what is under it (F6), a marker
// whose citation has not arrived yet is an inert placeholder while the turn streams (N1), and a
// marker followed by punctuation reads tight.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CITES: AskUniCitation[] = [
  {
    sourceId: 'S1',
    kind: 'document',
    title: 'Q3 plan.docx',
    quote: 'Budget is frozen until July',
    href: '/o/w/documents/1',
  },
]

function turn(over: Partial<AskUniTurnMessage> = {}): AskUniTurnMessage {
  return {
    id: 'm-1',
    role: 'assistant',
    content: 'The budget is frozen [S1].',
    citations: CITES,
    ...over,
  }
}

describe('Ask UNI answer polish', () => {
  let host: HTMLDivElement
  let root: Root
  let fake: FakeAdapter

  async function mount(message: AskUniTurnMessage, props: Record<string, unknown> = {}) {
    await act(async () => {
      root.render(
        h(AskUniAdapterProvider, {
          adapter: fake.adapter,
          children: h('ul', null, h(AskUniTurn, { message, ...props })),
        }),
      )
    })
  }

  const marker = () => host.querySelector('button.askuni-v2-cite') as HTMLElement
  const card = () => host.querySelector('[role="dialog"]') as HTMLElement | null
  // React derives mouseenter/mouseleave from mouseover/mouseout
  const pointerEnter = async (el: Element) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    })
  }
  const pointerLeave = async (el: Element) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })
  }
  const wait = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    fake = fakeAdapter()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  describe('F6 hover preview', () => {
    it('a card opened by hover is a preview and closes when the pointer leaves the marker', async () => {
      await mount(turn())
      await pointerEnter(marker())
      await wait(200)
      expect(card()).not.toBeNull()
      expect(card()!.classList.contains('is-preview')).toBe(true)
      await pointerLeave(marker().parentElement!)
      await wait(200)
      expect(card()).toBeNull()
    })

    it('a card opened by click is pinned: interactive, and it stays after the pointer leaves', async () => {
      await mount(turn())
      await act(async () => {
        marker().click()
      })
      expect(card()).not.toBeNull()
      expect(card()!.classList.contains('is-preview')).toBe(false)
      await pointerEnter(marker())
      await pointerLeave(marker().parentElement!)
      await wait(300)
      expect(card()).not.toBeNull()
      expect(card()!.classList.contains('is-preview')).toBe(false)
    })

    it('a card opened by focus is pinned and stays after the pointer leaves', async () => {
      await mount(turn())
      await act(async () => {
        marker().focus()
      })
      expect(card()!.classList.contains('is-preview')).toBe(false)
      await pointerEnter(marker())
      await pointerLeave(marker().parentElement!)
      await wait(300)
      expect(card()).not.toBeNull()
    })

    it('clicking the marker while a hover preview is open pins it', async () => {
      await mount(turn())
      await pointerEnter(marker())
      await wait(200)
      expect(card()!.classList.contains('is-preview')).toBe(true)
      await act(async () => {
        marker().click()
      })
      expect(card()!.classList.contains('is-preview')).toBe(false)
      await pointerLeave(marker().parentElement!)
      await wait(300)
      expect(card()).not.toBeNull()
    })

    it('a pinned card closes on Escape, and the next hover is a preview again', async () => {
      await mount(turn())
      await act(async () => {
        marker().click()
      })
      await act(async () => {
        marker().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(card()).toBeNull()
      await pointerEnter(marker())
      await wait(200)
      expect(card()!.classList.contains('is-preview')).toBe(true)
    })
  })

  describe('N1 marker while streaming', () => {
    const streaming = { streaming: true }
    const content = 'Revenue was 120M [S1] and costs fell [S2].'

    it('shows an inert placeholder, never raw [Sn] text, for a citation that has not arrived', async () => {
      await mount(turn({ id: 'live', content, citations: [] }), streaming)
      expect(host.textContent).not.toContain('[S1]')
      expect(host.textContent).not.toContain('[S2]')
      expect(host.querySelector('.askuni-v2-body button')).toBeNull()
      const placeholders = host.querySelectorAll('.askuni-v2-cite.is-pending')
      expect(placeholders).toHaveLength(2)
      expect(placeholders[0]!.getAttribute('aria-hidden')).toBe('true')
      expect(placeholders[0]!.textContent).toBe('1')
      expect(card()).toBeNull()
    })

    it('keeps a matched marker a real button while the turn streams', async () => {
      await mount(turn({ id: 'live', content, citations: CITES }), streaming)
      expect(host.querySelectorAll('button.askuni-v2-cite')).toHaveLength(1)
      expect(host.querySelectorAll('.askuni-v2-cite.is-pending')).toHaveLength(1)
    })

    it('once the turn is done an unmatched marker stays plain text', async () => {
      await mount(turn({ content, citations: [] }))
      expect(host.textContent).toContain('[S1]')
      expect(host.textContent).toContain('[S2]')
      expect(host.querySelector('.askuni-v2-cite')).toBeNull()
    })
  })

  describe('marker followed by punctuation', () => {
    it('drops the space before a marker so it sits tight on the word', async () => {
      await mount(turn({ content: 'Revenue was 120M [S1], up 4%.' }))
      expect(host.querySelector('.askuni-v2-body p')!.textContent).toBe('Revenue was 120M1, up 4%.')
    })

    it('keeps the space before an unmatched marker that stays text', async () => {
      await mount(turn({ content: 'Unsure [S7], but sure.', citations: [] }))
      expect(host.querySelector('.askuni-v2-body p')!.textContent).toBe('Unsure [S7], but sure.')
    })
  })
})
