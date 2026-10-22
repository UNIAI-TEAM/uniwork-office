/** @vitest-environment jsdom */
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AskUniCitation,
  AskUniFeedbackClearRequest,
  AskUniFeedbackRequest,
  AskUniOkResult,
} from '@genoffice/ai-provider/askuni'
import {
  AskUniActions,
  AskUniAdapterProvider,
  answerPlainText,
  clearAskUniRatings,
} from '../src/ask-uni'
import { fakeAdapter, type FakeAdapter } from './ask-uni-kit'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CITES: AskUniCitation[] = [
  { sourceId: 'S1', kind: 'document', title: 'Q3 plan.docx', quote: 'q', href: '/d/1' },
  { sourceId: 'S2', kind: 'task', title: 'Fix invoice export', quote: 'q', href: '/t/2' },
]

describe('answerPlainText (what Copy puts on the clipboard)', () => {
  it('replaces a matching [Sn] with the title of that source', () => {
    expect(answerPlainText('Frozen [S1] and due Friday [S2].', CITES)).toBe(
      'Frozen [Q3 plan.docx] and due Friday [Fix invoice export].',
    )
  })

  it('drops a marker that matches no source, with the space before it', () => {
    expect(answerPlainText('Maybe true [S9].', CITES)).toBe('Maybe true.')
  })

  it('matches the source id case-insensitively', () => {
    const lower = [{ ...CITES[0]!, sourceId: 's1' }]
    expect(answerPlainText('A [S1] b', lower)).toBe('A [Q3 plan.docx] b')
  })

  it('leaves text without markers alone', () => {
    expect(answerPlainText('Plain **bold** text', CITES)).toBe('Plain **bold** text')
  })
})

describe('AskUniActions', () => {
  let host: HTMLDivElement
  let root: Root
  let setFeedback: ReturnType<typeof vi.fn<(r: AskUniFeedbackRequest) => Promise<AskUniOkResult>>>
  let clearFeedback: ReturnType<
    typeof vi.fn<(r: AskUniFeedbackClearRequest) => Promise<AskUniOkResult>>
  >
  let fake: FakeAdapter
  let writeText: ReturnType<typeof vi.fn<(t: string) => Promise<void>>>
  let onRegenerate: ReturnType<typeof vi.fn<() => void>>

  type Over = Partial<{
    content: string
    messageId: string
    regenerate: boolean
    regenerateDisabled: boolean
    lang: 'en' | 'vi'
  }>

  async function mount(over: Over = {}): Promise<void> {
    const used = over.lang === 'vi' ? fakeAdapter('vi') : fake
    await act(async () => {
      root.render(
        h(AskUniAdapterProvider, {
          adapter: used.adapter,
          children: h(AskUniActions, {
            conversationId: 'conv-1',
            messageId: over.messageId ?? 'm-1',
            content: over.content ?? 'Budget is frozen [S1].',
            citations: CITES,
            onRegenerate: over.regenerate === false ? undefined : onRegenerate,
            regenerateDisabled: over.regenerateDisabled,
          }),
        }),
      )
    })
  }

  const btn = (label: string) =>
    host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null
  const click = async (el: Element | null) => {
    await act(async () => {
      ;(el as HTMLElement).click()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    clearAskUniRatings()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    fake = fakeAdapter()
    setFeedback = fake.feedbackSet
    clearFeedback = fake.feedbackClear
    onRegenerate = vi.fn()
    writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    host.remove()
  })

  describe('copy', () => {
    it('copies the plain text with [Sn] turned into the source title', async () => {
      await mount()
      await click(btn('Copy'))
      expect(writeText).toHaveBeenCalledExactlyOnceWith('Budget is frozen [Q3 plan.docx].')
    })

    it('says Copied for 1.5 s, then goes back', async () => {
      vi.useFakeTimers()
      await mount()
      await click(btn('Copy'))
      expect(btn('Copied')).not.toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600)
      })
      expect(btn('Copy')).not.toBeNull()
    })

    it('leaves the button unchanged when the clipboard refuses', async () => {
      writeText.mockRejectedValueOnce(new Error('denied'))
      await mount()
      await click(btn('Copy'))
      expect(btn('Copy')).not.toBeNull()
      expect(btn('Copied')).toBeNull()
    })
  })

  describe('regenerate', () => {
    it('is shown for the last answer only (when a handler is passed) and calls it', async () => {
      await mount()
      await click(btn('Regenerate'))
      expect(onRegenerate).toHaveBeenCalledTimes(1)
      await mount({ regenerate: false })
      expect(btn('Regenerate')).toBeNull()
    })

    it('does nothing while disabled (a turn is running)', async () => {
      await mount({ regenerateDisabled: true })
      expect(btn('Regenerate')?.getAttribute('aria-disabled')).toBe('true')
      await click(btn('Regenerate'))
      expect(onRegenerate).not.toHaveBeenCalled()
    })
  })

  describe('an answer without text (stopped before any, or no sources)', () => {
    it('has neither copy nor rating, only regenerate', async () => {
      await mount({ content: '' })
      expect(btn('Copy')).toBeNull()
      expect(btn('Helpful')).toBeNull()
      expect(btn('Not right')).toBeNull()
      expect(btn('Regenerate')).not.toBeNull()
    })

    it('renders nothing at all when there is no regenerate either', async () => {
      await mount({ content: '  ', regenerate: false })
      expect(host.querySelector('button')).toBeNull()
    })
  })

  describe('rating up', () => {
    it('sends rating up and shows it pressed', async () => {
      await mount()
      expect(btn('Helpful')?.getAttribute('aria-pressed')).toBe('false')
      await click(btn('Helpful'))
      expect(setFeedback).toHaveBeenCalledExactlyOnceWith({
        conversationId: 'conv-1',
        messageId: 'm-1',
        rating: 'up',
      })
      expect(btn('Helpful')?.getAttribute('aria-pressed')).toBe('true')
    })

    it('clears the rating when pressed again', async () => {
      await mount()
      await click(btn('Helpful'))
      await click(btn('Helpful'))
      expect(clearFeedback).toHaveBeenCalledExactlyOnceWith({
        conversationId: 'conv-1',
        messageId: 'm-1',
      })
      expect(btn('Helpful')?.getAttribute('aria-pressed')).toBe('false')
    })

    it('goes back when the server refuses', async () => {
      setFeedback.mockResolvedValueOnce({ ok: false, error: 'error' })
      await mount()
      await click(btn('Helpful'))
      expect(btn('Helpful')?.getAttribute('aria-pressed')).toBe('false')
    })

    it('goes back when the call throws', async () => {
      setFeedback.mockRejectedValueOnce(new Error('net'))
      await mount()
      await click(btn('Helpful'))
      expect(btn('Helpful')?.getAttribute('aria-pressed')).toBe('false')
    })

    it('remembers the rating while the session lasts (the server never returns it)', async () => {
      await mount()
      await click(btn('Helpful'))
      await act(async () => root.unmount())
      root = createRoot(host)
      await mount()
      expect(btn('Helpful')?.getAttribute('aria-pressed')).toBe('true')
      clearAskUniRatings()
      await act(async () => root.unmount())
      root = createRoot(host)
      await mount()
      expect(btn('Helpful')?.getAttribute('aria-pressed')).toBe('false')
    })

    it('keeps ratings apart per message', async () => {
      await mount()
      await click(btn('Helpful'))
      await mount({ messageId: 'm-2' })
      expect(btn('Helpful')?.getAttribute('aria-pressed')).toBe('false')
    })
  })

  describe('rating down', () => {
    const menu = () => host.querySelector('[role="dialog"]') as HTMLElement | null
    const radio = (reason: string) =>
      host.querySelector(`input[type="radio"][value="${reason}"]`) as HTMLInputElement
    const note = () => host.querySelector('textarea') as HTMLTextAreaElement
    const type = async (el: HTMLTextAreaElement, value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }

    it('opens a reason menu with the four web reasons and a note, and does not send yet', async () => {
      await mount()
      expect(menu()).toBeNull()
      await click(btn('Not right'))
      expect(menu()).not.toBeNull()
      expect(menu()?.textContent).toContain('What was wrong with the answer?')
      for (const label of ['Wrong facts', 'Missing sources', 'Not helpful', 'Something else']) {
        expect(menu()?.textContent).toContain(label)
      }
      expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(4)
      expect(note().maxLength).toBe(500)
      expect(setFeedback).not.toHaveBeenCalled()
    })

    it('sends rating down with the reason and the trimmed note', async () => {
      await mount()
      await click(btn('Not right'))
      await click(radio('wrong_facts'))
      await type(note(), '  The date is wrong  ')
      expect(menu()?.textContent).toContain('21/500')
      await click(
        [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send feedback')!,
      )
      expect(setFeedback).toHaveBeenCalledExactlyOnceWith({
        conversationId: 'conv-1',
        messageId: 'm-1',
        rating: 'down',
        reason: 'wrong_facts',
        note: 'The date is wrong',
      })
      expect(menu()).toBeNull()
      expect(btn('Not right')?.getAttribute('aria-pressed')).toBe('true')
    })

    it('can send without a reason or a note', async () => {
      await mount()
      await click(btn('Not right'))
      await click(
        [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send feedback')!,
      )
      expect(setFeedback).toHaveBeenCalledExactlyOnceWith({
        conversationId: 'conv-1',
        messageId: 'm-1',
        rating: 'down',
      })
    })

    it('goes back when the server refuses', async () => {
      setFeedback.mockResolvedValueOnce({ ok: false, error: 'error' })
      await mount()
      await click(btn('Not right'))
      await click(
        [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send feedback')!,
      )
      expect(btn('Not right')?.getAttribute('aria-pressed')).toBe('false')
    })

    it('closes on Escape and gives focus back to the button', async () => {
      await mount()
      await click(btn('Not right'))
      await act(async () => {
        menu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(menu()).toBeNull()
      expect(document.activeElement).toBe(btn('Not right'))
    })

    it('rating up after rating down replaces it', async () => {
      await mount()
      await click(btn('Not right'))
      await click(
        [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send feedback')!,
      )
      await click(btn('Helpful'))
      expect(btn('Helpful')?.getAttribute('aria-pressed')).toBe('true')
      expect(btn('Not right')?.getAttribute('aria-pressed')).toBe('false')
    })
  })

  it('an explicit feedback prop wins over the adapter calls', async () => {
    const own = {
      set: vi.fn(async () => ({ ok: true as const })),
      clear: vi.fn(async () => ({ ok: true as const })),
    }
    await act(async () => {
      root.render(
        h(AskUniAdapterProvider, {
          adapter: fake.adapter,
          children: h(AskUniActions, {
            conversationId: 'conv-1',
            messageId: 'm-1',
            content: 'Budget is frozen.',
            citations: [],
            feedback: own,
          }),
        }),
      )
    })
    await click(btn('Helpful'))
    expect(own.set).toHaveBeenCalledTimes(1)
    expect(setFeedback).not.toHaveBeenCalled()
  })

  it('uses the web Vietnamese wording in vi', async () => {
    await mount({ lang: 'vi' })
    for (const label of ['Sao chép', 'Trả lời lại', 'Hữu ích', 'Chưa đúng']) {
      expect(btn(label), label).not.toBeNull()
    }
  })

  it('every action button is reachable by keyboard (no tabindex -1) and typed as button', async () => {
    await mount()
    for (const b of host.querySelectorAll('button')) {
      expect(b.getAttribute('type')).toBe('button')
      expect(b.getAttribute('tabindex')).not.toBe('-1')
    }
  })
})
