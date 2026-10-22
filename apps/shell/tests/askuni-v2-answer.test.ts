// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { AskUniTurn, type AskUniTurnMessage } from '../src/renderer/src/askuni-v2/AskUniAnswer'
import { AskUniSteps } from '../src/renderer/src/askuni-v2/AskUniSteps'
import { en } from '../src/renderer/src/i18n/askuni/en'
import { vi as viStrings } from '../src/renderer/src/i18n/askuni/vi'
import { zh } from '../src/renderer/src/i18n/askuni/zh'
import type { AskUniCitation, AskUniOpenRequest, AskUniOpenResult } from '../src/shared/askuni-api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CITES: AskUniCitation[] = [
  {
    sourceId: 'S1',
    kind: 'document',
    title: 'Q3 plan.docx',
    quote: 'Budget is frozen until July',
    href: '/o/w/documents/1',
  },
  {
    sourceId: 'S2',
    kind: 'task',
    title: 'Fix invoice export',
    quote: 'Due Friday',
    href: '/o/w/tasks/2',
  },
  { sourceId: 'S3', kind: 'chat', title: '#ops', quote: 'Server is back', href: '' },
]

function turn(over: Partial<AskUniTurnMessage> = {}): AskUniTurnMessage {
  return {
    id: 'm-1',
    role: 'assistant',
    content: 'The budget is frozen [S1] and the export is due Friday [S2].',
    citations: CITES,
    ...over,
  }
}

describe('Ask UNI v2 answer', () => {
  let host: HTMLDivElement
  let root: Root
  let openCitation: ReturnType<typeof vi.fn<(r: AskUniOpenRequest) => Promise<AskUniOpenResult>>>

  async function mount(
    message: AskUniTurnMessage,
    props: Record<string, unknown> = {},
    lang: 'en' | 'vi' = 'en',
  ): Promise<void> {
    await act(async () => {
      root.render(
        h(LocaleProvider, {
          initial: lang,
          children: h('ul', null, h(AskUniTurn, { message, ...props })),
        }),
      )
    })
  }

  const marker = (n: number, title: string, label = 'Source') =>
    host.querySelector(`[aria-label="${label} ${n}: ${title}"]`) as HTMLElement | null
  const card = () => host.querySelector('[role="dialog"]') as HTMLElement | null
  const chips = () => host.querySelector(`ul[aria-label="${en.askUniSources}"]`)
  const click = async (el: Element | null) => {
    await act(async () => {
      ;(el as HTMLElement).click()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    openCitation = vi.fn(async () => ({ ok: true as const }))
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {
      uniworkAskUniOpenCitation: openCitation,
      askUniFeedbackSet: vi.fn(async () => ({ ok: true })),
      askUniFeedbackClear: vi.fn(async () => ({ ok: true })),
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
  })

  describe('turns', () => {
    it('shows the question as plain text with no actions', async () => {
      await mount({ id: 'q', role: 'user', content: 'What is **blocked**?', citations: [] })
      expect(host.textContent).toContain('What is **blocked**?')
      expect(host.querySelector('strong')).toBeNull()
      expect(host.querySelector('button')).toBeNull()
    })

    it('renders the answer as markdown', async () => {
      await mount(turn({ content: 'Intro\n\n- **one**\n- two', citations: [] }))
      expect(host.querySelector('strong')?.textContent).toBe('one')
      expect(host.querySelectorAll('li li')).toHaveLength(2)
    })

    it('keeps raw HTML inert and external links as plain text', async () => {
      await mount(
        turn({
          content:
            '<img src=x onerror="alert(1)"> hi <script>boom()</script> [site](https://evil.example/x)',
          citations: [],
        }),
      )
      expect(host.querySelector('img')).toBeNull()
      expect(host.querySelector('script')).toBeNull()
      expect(host.querySelector('a[href]')).toBeNull()
      expect(host.textContent).toContain('hi')
    })
  })

  describe('[Sn] markers', () => {
    it('turns a [Sn] that matches a citation into a marker named after its source', async () => {
      await mount(turn())
      const m1 = marker(1, 'Q3 plan.docx')
      const m2 = marker(2, 'Fix invoice export')
      expect(m1?.textContent).toBe('1')
      expect(m2?.textContent).toBe('2')
      expect(host.textContent).not.toContain('[S1]')
    })

    it('uses the web Vietnamese name in vi', async () => {
      await mount(turn(), {}, 'vi')
      expect(marker(1, 'Q3 plan.docx', 'Nguồn')).not.toBeNull()
    })

    it('leaves a [Sn] without a citation as plain text', async () => {
      await mount(turn({ content: 'Unsure [S7] but sure [S1].' }))
      expect(host.textContent).toContain('[S7]')
      expect(host.querySelectorAll('[aria-label^="Source "]')).toHaveLength(1)
    })

    it('handles adjacent markers and a lower-case source id', async () => {
      await mount(
        turn({
          content: 'Both [S1][S2].',
          citations: CITES.map((c) => ({ ...c, sourceId: c.sourceId.toLowerCase() })),
        }),
      )
      expect(marker(1, 'Q3 plan.docx')).not.toBeNull()
      expect(marker(2, 'Fix invoice export')).not.toBeNull()
    })

    it('does not touch a [Sn] inside inline code or a fenced block', async () => {
      await mount(turn({ content: 'Use `[S1]` here.\n\n```\n[S2]\n```' }))
      expect(host.querySelectorAll('[aria-label^="Source "]')).toHaveLength(0)
      expect(host.textContent).toContain('[S1]')
      expect(host.textContent).toContain('[S2]')
    })

    it('does not let the model fake a marker with a link', async () => {
      await mount(turn({ content: 'See [fake](askuni-cite://S1) and [S2].' }))
      expect(host.querySelectorAll('[aria-label^="Source "]')).toHaveLength(1)
      expect(marker(2, 'Fix invoice export')).not.toBeNull()
    })

    it('opens a card with the source title, quote and an Open action on click', async () => {
      await mount(turn())
      expect(card()).toBeNull()
      await click(marker(1, 'Q3 plan.docx'))
      expect(card()?.textContent).toContain('Q3 plan.docx')
      expect(card()?.textContent).toContain('Budget is frozen until July')
      const open = [...card()!.querySelectorAll('button')].find((b) => b.textContent === 'Open')
      expect(open).toBeDefined()
      await click(open!)
      expect(openCitation).toHaveBeenCalledExactlyOnceWith({
        kind: 'document',
        href: '/o/w/documents/1',
      })
    })

    it('opens the card on keyboard focus too and closes it on Escape', async () => {
      await mount(turn())
      await act(async () => {
        marker(2, 'Fix invoice export')?.focus()
      })
      expect(card()?.textContent).toContain('Due Friday')
      await act(async () => {
        marker(2, 'Fix invoice export')?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        )
      })
      expect(card()).toBeNull()
    })

    it('a source with no server path shows its quote and no Open action', async () => {
      await mount(turn({ content: 'Ops said so [S3].' }))
      await click(marker(3, '#ops'))
      expect(card()?.textContent).toContain('Server is back')
      expect(card()?.querySelector('button')).toBeNull()
    })

    it('has one card open at a time', async () => {
      await mount(turn())
      await click(marker(1, 'Q3 plan.docx'))
      await click(marker(2, 'Fix invoice export'))
      expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      expect(card()?.textContent).toContain('Due Friday')
    })
  })

  describe('source chips', () => {
    it('lists one chip per citation with its S label and title', async () => {
      await mount(turn())
      const items = [...chips()!.querySelectorAll('li')]
      expect(items).toHaveLength(3)
      expect(items[0]?.textContent).toContain('S1')
      expect(items[0]?.textContent).toContain('Q3 plan.docx')
    })

    it('opens the source through the existing citation bridge', async () => {
      await mount(turn())
      const chip = chips()!.querySelector(
        `button[aria-label="${en.askUniKindDocument}: Q3 plan.docx — ${en.askUniOpenDocument}"]`,
      )
      expect(chip).not.toBeNull()
      await click(chip)
      expect(openCitation).toHaveBeenCalledExactlyOnceWith({
        kind: 'document',
        href: '/o/w/documents/1',
      })
    })

    it('says so when the source cannot be opened', async () => {
      openCitation.mockResolvedValueOnce({ ok: false, code: 'error' })
      await mount(turn())
      await click(chips()!.querySelector('button'))
      expect(host.textContent).toContain(en.askUniOpenFailed)
    })

    it('says so when the bridge throws', async () => {
      openCitation.mockRejectedValueOnce(new Error('x'))
      await mount(turn())
      await click(chips()!.querySelector('button'))
      expect(host.textContent).toContain(en.askUniOpenFailed)
    })

    it('shows a source without a path as a plain chip, not a button', async () => {
      await mount(turn())
      const items = [...chips()!.querySelectorAll('li')]
      expect(items[2]?.textContent).toContain('#ops')
      expect(items[2]?.querySelector('button')).toBeNull()
    })

    it('shows an unknown kind as the generic row', async () => {
      await mount(
        turn({
          citations: [
            { sourceId: 'S1', kind: 'workload' as never, title: 'Load', quote: '', href: '/w/1' },
          ],
        }),
      )
      expect(
        chips()!.querySelector(
          `button[aria-label="${en.askUniKindOther}: Load — ${en.askUniOpenBrowser}"]`,
        ),
      ).not.toBeNull()
    })

    it('has no chip row when there are no sources', async () => {
      await mount(turn({ citations: [] }))
      expect(chips()).toBeNull()
    })
  })

  describe('notices', () => {
    it('no_sources with no text says nothing matched', async () => {
      await mount(turn({ content: '', citations: [], notice: 'no_sources' }))
      expect(host.textContent).toContain(en.askUniNoticeNoSources)
    })

    it('empty_answer with no text says UNI had nothing to say', async () => {
      await mount(turn({ content: '', citations: [], notice: 'empty_answer' }))
      expect(host.textContent).toContain(en.askUniV2NoticeEmptyAnswer)
    })

    it('stopped keeps the partial text and adds the note', async () => {
      await mount(turn({ content: 'Half an answ', citations: [], notice: 'stopped' }))
      expect(host.textContent).toContain('Half an answ')
      expect(host.textContent).toContain(en.askUniV2NoticeStopped)
    })

    it('stopped before any text shows only the note', async () => {
      await mount(turn({ content: '', citations: [], notice: 'stopped' }))
      expect(host.textContent).toContain(en.askUniV2NoticeStopped)
      expect(host.querySelector('.ai-md')).toBeNull()
    })

    it('a notice never replaces an answer that has text (other than stopped)', async () => {
      await mount(turn({ content: 'Has text', citations: [], notice: 'no_sources' }))
      expect(host.textContent).not.toContain(en.askUniNoticeNoSources)
    })
  })

  describe('live turn', () => {
    it('shows the working state before the first text', async () => {
      await mount(turn({ id: 'live', content: '', citations: [] }), { streaming: true })
      expect(host.querySelector('.askuni-v2-working')?.textContent).toContain(en.askUniThinking)
    })

    it('shows the working state between steps (draft cleared, counts present)', async () => {
      await mount(turn({ id: 'live', content: '', citations: [] }), {
        streaming: true,
        counts: { task: 2 },
      })
      expect(host.querySelector('.askuni-v2-working')).not.toBeNull()
      expect(host.textContent).toContain('Looked at 2 tasks')
    })

    it('shows the text as it streams without the working state, and no actions', async () => {
      await mount(turn({ id: 'live', content: 'Partial text', citations: [] }), {
        streaming: true,
        conversationId: 'conv-1',
      })
      expect(host.textContent).toContain('Partial text')
      expect(host.querySelector('.askuni-v2-working')).toBeNull()
      expect(host.querySelector('button[aria-label="Copy"]')).toBeNull()
    })

    it('marks nothing as working once finished', async () => {
      await mount(turn(), { conversationId: 'conv-1' })
      expect(host.querySelector('.askuni-v2-working')).toBeNull()
    })
  })

  describe('actions under an answer', () => {
    it('shows copy and ratings for a stored answer', async () => {
      await mount(turn(), { conversationId: 'conv-1' })
      expect(host.querySelector('button[aria-label="Copy"]')).not.toBeNull()
      expect(host.querySelector('button[aria-label="Helpful"]')).not.toBeNull()
    })

    it('shows none without a conversation, for a pending echo or while streaming', async () => {
      await mount(turn())
      expect(host.querySelector('button[aria-label="Copy"]')).toBeNull()
      await mount(turn({ id: 'pending-m-1' }), { conversationId: 'conv-1' })
      expect(host.querySelector('button[aria-label="Copy"]')).toBeNull()
      await mount(turn(), { conversationId: 'conv-1', streaming: true })
      expect(host.querySelector('button[aria-label="Copy"]')).toBeNull()
    })

    it('passes regenerate through for the last answer', async () => {
      const onRegenerate = vi.fn()
      await mount(turn(), { conversationId: 'conv-1', onRegenerate })
      await click(host.querySelector('button[aria-label="Regenerate"]'))
      expect(onRegenerate).toHaveBeenCalledTimes(1)
    })
  })
})

describe('AskUniSteps', () => {
  let host: HTMLDivElement
  let root: Root

  async function mount(counts: Record<string, number>, lang: 'en' | 'vi' = 'en'): Promise<void> {
    await act(async () => {
      root.render(h(LocaleProvider, { initial: lang, children: h(AskUniSteps, { counts }) }))
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('summarizes what UNI looked at, with plural forms', async () => {
    await mount({ task: 24, meeting: 3, document: 1 })
    expect(host.querySelector('button')?.textContent).toContain(
      'Looked at 24 tasks, 3 meetings, 1 document',
    )
  })

  it('uses the singular for one', async () => {
    await mount({ project: 1, chat: 2 })
    expect(host.querySelector('button')?.textContent).toContain('Looked at 1 project, 2 chats')
  })

  it('uses the web Vietnamese wording', async () => {
    await mount({ task: 24, meeting: 3, chat: 1 }, 'vi')
    expect(host.querySelector('button')?.textContent).toContain(
      'Đã xem 24 task, 3 cuộc họp, 1 đoạn chat',
    )
  })

  it('ignores kinds that mean nothing to a reader and zero counts', async () => {
    await mount({ member: 4, workload: 2, task: 0, document: 2 })
    const text = host.querySelector('button')?.textContent ?? ''
    expect(text).toContain('Looked at 2 documents')
    expect(text).not.toContain('member')
  })

  it('renders nothing when there is nothing to say', async () => {
    await mount({ member: 4, task: 0 })
    expect(host.firstChild).toBeNull()
  })

  it('collapses to a summary and expands to the per-kind lines', async () => {
    await mount({ task: 2, meeting: 1 })
    const toggle = host.querySelector('button') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelectorAll('li')).toHaveLength(0)
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '2 tasks',
      '1 meeting',
    ])
    await act(async () => toggle.click())
    expect(host.querySelectorAll('li')).toHaveLength(0)
  })
})

describe('Ask UNI v2 wording', () => {
  it('reuses the web en/vi strings for the answer, notices and actions', () => {
    expect(en.askUniV2NoticeStopped).toBe('Stopped before the answer was finished.')
    expect(viStrings.askUniV2NoticeStopped).toBe('Đã dừng trước khi trả lời xong.')
    expect(en.askUniV2NoticeEmptyAnswer).toBe(
      'UNI had nothing to say. Ask again or be more specific.',
    )
    expect(viStrings.askUniV2NoticeEmptyAnswer).toBe(
      'UNI không có nội dung nào để trả lời. Hãy hỏi lại hoặc nêu cụ thể hơn.',
    )
    expect(en.askUniV2ErrProviderError).toBe(
      "The AI service isn't responding. Try again in a few minutes.",
    )
    expect(viStrings.askUniV2ErrProviderError).toBe(
      'Dịch vụ AI đang gặp sự cố, thử lại sau ít phút.',
    )
    expect(en.askUniV2ErrProviderTimeout).toBe('UNI took too long to answer. Try again.')
    expect(en.askUniV2ErrOutputInvalid).toBe(
      'UNI answered in an unexpected format; please ask again.',
    )
    expect(en.askUniV2ErrToolNotAllowed).toBe(
      "UNI tried something it isn't allowed to do. Ask again.",
    )
    expect(en.askUniV2ErrRefused).toBe("UNI can't answer this question.")
    expect(viStrings.askUniV2ErrRefused).toBe('UNI không thể trả lời câu hỏi này.')
  })

  it('has the new keys in zh, en and vi with the same {params}', () => {
    const keys = Object.keys(zh).filter((k) => k.startsWith('askUniV2'))
    expect(keys.length).toBeGreaterThan(30)
    const params = (v: string) => (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join()
    for (const k of keys) {
      const z = (zh as Record<string, string>)[k]!
      for (const table of [en, viStrings] as Record<string, string>[]) {
        expect(table[k], k).toBeTruthy()
        expect(params(table[k]!), k).toBe(params(z))
      }
    }
  })
})
