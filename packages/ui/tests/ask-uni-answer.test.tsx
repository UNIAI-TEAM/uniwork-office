/** @vitest-environment jsdom */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AskUniCitation } from '@genoffice/ai-provider/askuni'
import {
  AskUniAdapterProvider,
  AskUniSteps,
  AskUniTurn,
  type AskUniTurnMessage,
} from '../src/ask-uni'
import { askUniText, askUniStrings } from '../src/strings-ask-uni'
import { fakeAdapter, type FakeAdapter } from './ask-uni-kit'

// One question or answer, the [Sn] markers, the source chips, notices and the step summary over an
// injected adapter (ported from the shell answer tests, which keep running through the shell wrapper).

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const en = (key: Parameters<typeof askUniText>[1]) => askUniText('en', key)

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

describe('Ask UNI answer (adapter)', () => {
  let host: HTMLDivElement
  let root: Root
  let fake: FakeAdapter

  async function mount(
    message: AskUniTurnMessage,
    props: Record<string, unknown> = {},
    lang: 'en' | 'vi' = 'en',
  ): Promise<void> {
    if (lang !== 'en') fake = fakeAdapter(lang)
    await act(async () => {
      root.render(
        h(AskUniAdapterProvider, {
          adapter: fake.adapter,
          children: h('ul', null, h(AskUniTurn, { message, ...props })),
        }),
      )
    })
  }

  const marker = (n: number, title: string, label = 'Source') =>
    host.querySelector(`[aria-label="${label} ${n}: ${title}"]`) as HTMLElement | null
  const card = () => host.querySelector('[role="dialog"]') as HTMLElement | null
  const chips = () => host.querySelector(`ul[aria-label="${en('askUniSources')}"]`)
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
    fake = fakeAdapter()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  describe('turns', () => {
    it('shows the question as plain text with no actions', async () => {
      await mount({ id: 'q', role: 'user', content: 'What is **blocked**?', citations: [] })
      expect(host.textContent).toContain('What is **blocked**?')
      expect(host.querySelector('strong')).toBeNull()
      expect(host.querySelector('button')).toBeNull()
    })

    it('renders the answer as markdown and keeps raw HTML and external links inert', async () => {
      await mount(turn({ content: 'Intro\n\n- **one**\n- two', citations: [] }))
      expect(host.querySelector('strong')?.textContent).toBe('one')
      await mount(
        turn({
          content:
            '<img src=x onerror="alert(1)"> hi <script>boom()</script> [s](https://e.example)',
          citations: [],
        }),
      )
      expect(host.querySelector('img')).toBeNull()
      expect(host.querySelector('script')).toBeNull()
      expect(host.querySelector('a[href]')).toBeNull()
    })
  })

  describe('[Sn] markers', () => {
    it('turns a [Sn] that matches a citation into a marker named after its source', async () => {
      await mount(turn())
      expect(marker(1, 'Q3 plan.docx')?.textContent).toBe('1')
      expect(marker(2, 'Fix invoice export')?.textContent).toBe('2')
      expect(host.textContent).not.toContain('[S1]')
    })

    it('uses the Vietnamese name in vi', async () => {
      await mount(turn(), {}, 'vi')
      expect(marker(1, 'Q3 plan.docx', 'Nguồn')).not.toBeNull()
    })

    it('leaves a [Sn] without a citation, and one inside code, as plain text', async () => {
      await mount(turn({ content: 'Unsure [S7] but sure [S1].' }))
      expect(host.textContent).toContain('[S7]')
      expect(host.querySelectorAll('[aria-label^="Source "]')).toHaveLength(1)
      await mount(turn({ content: 'Use `[S1]` here.\n\n```\n[S2]\n```' }))
      expect(host.querySelectorAll('[aria-label^="Source "]')).toHaveLength(0)
    })

    it('opens a card with the source title and quote, and Open goes through the adapter', async () => {
      await mount(turn())
      expect(card()).toBeNull()
      await click(marker(1, 'Q3 plan.docx'))
      expect(card()?.textContent).toContain('Budget is frozen until July')
      const open = [...card()!.querySelectorAll('button')].find((b) => b.textContent === 'Open')
      await click(open!)
      expect(fake.openCitation).toHaveBeenCalledExactlyOnceWith({
        kind: 'document',
        href: '/o/w/documents/1',
      })
    })

    it('opens the card on keyboard focus too, closes it on Escape, one card at a time', async () => {
      await mount(turn())
      await act(async () => {
        marker(2, 'Fix invoice export')?.focus()
      })
      expect(card()?.textContent).toContain('Due Friday')
      await click(marker(1, 'Q3 plan.docx'))
      expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      await act(async () => {
        marker(1, 'Q3 plan.docx')?.dispatchEvent(
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
  })

  describe('source chips', () => {
    it('lists one chip per citation and opens a source through the adapter', async () => {
      await mount(turn())
      expect([...chips()!.querySelectorAll('li')]).toHaveLength(3)
      const chip = chips()!.querySelector(
        `button[aria-label="${en('askUniKindDocument')}: Q3 plan.docx — ${en('askUniOpenDocument')}"]`,
      )
      await click(chip)
      expect(fake.openCitation).toHaveBeenCalledExactlyOnceWith({
        kind: 'document',
        href: '/o/w/documents/1',
      })
    })

    it('says so when the source cannot be opened (a refusal and a throw)', async () => {
      fake.openCitation.mockResolvedValueOnce(false)
      await mount(turn())
      await click(chips()!.querySelector('button'))
      expect(host.textContent).toContain(en('askUniOpenFailed'))
      await mount(turn({ id: 'm-2' }))
      fake.openCitation.mockRejectedValueOnce(new Error('x'))
      await click(chips()!.querySelector('button'))
      expect(host.textContent).toContain(en('askUniOpenFailed'))
    })

    it('shows sources as plain chips with no Open action when the host cannot open them', async () => {
      const bare = fakeAdapter()
      const { openCitation: _omit, ...rest } = bare.adapter
      fake = { ...bare, adapter: rest }
      await mount(turn())
      expect(chips()!.querySelector('button')).toBeNull()
      expect([...chips()!.querySelectorAll('li')]).toHaveLength(3)
      await click(marker(1, 'Q3 plan.docx'))
      expect([...card()!.querySelectorAll('button')].some((b) => b.textContent === 'Open')).toBe(
        false,
      )
    })

    it('shows a source without a path as a plain chip, an unknown kind as the generic row', async () => {
      await mount(turn())
      expect([...chips()!.querySelectorAll('li')][2]?.querySelector('button')).toBeNull()
      await mount(
        turn({
          citations: [
            { sourceId: 'S1', kind: 'workload' as never, title: 'Load', quote: '', href: '/w/1' },
          ],
        }),
      )
      expect(
        chips()!.querySelector(
          `button[aria-label="${en('askUniKindOther')}: Load — ${en('askUniOpenBrowser')}"]`,
        ),
      ).not.toBeNull()
    })

    it('has no chip row when there are no sources', async () => {
      await mount(turn({ citations: [] }))
      expect(chips()).toBeNull()
    })
  })

  describe('notices and the live turn', () => {
    it('no_sources and empty_answer with no text say so; a notice never replaces text', async () => {
      await mount(turn({ content: '', citations: [], notice: 'no_sources' }))
      expect(host.textContent).toContain(en('askUniNoticeNoSources'))
      await mount(turn({ content: '', citations: [], notice: 'empty_answer' }))
      expect(host.textContent).toContain(en('askUniV2NoticeEmptyAnswer'))
      await mount(turn({ content: 'Has text', citations: [], notice: 'no_sources' }))
      expect(host.textContent).not.toContain(en('askUniNoticeNoSources'))
    })

    it('stopped keeps the partial text and adds the note', async () => {
      await mount(turn({ content: 'Half an answ', citations: [], notice: 'stopped' }))
      expect(host.textContent).toContain('Half an answ')
      expect(host.textContent).toContain(en('askUniV2NoticeStopped'))
    })

    it('shows the working state before the first text and none once there is text', async () => {
      await mount(turn({ id: 'live', content: '', citations: [] }), { streaming: true })
      expect(host.querySelector('.askuni-v2-working')).not.toBeNull()
      await mount(turn({ id: 'live', content: 'Partial', citations: [] }), { streaming: true })
      expect(host.querySelector('.askuni-v2-working')).toBeNull()
    })

    it('shows copy and ratings for a stored answer, none for a live or pending one', async () => {
      await mount(turn({ citations: [] }), { conversationId: 'conv-1' })
      expect(host.querySelector('button[aria-label="Copy"]')).not.toBeNull()
      await mount(turn({ id: 'pending-1', citations: [] }), { conversationId: 'conv-1' })
      expect(host.querySelector('button[aria-label="Copy"]')).toBeNull()
      await mount(turn({ citations: [] }), { conversationId: 'conv-1', streaming: true })
      expect(host.querySelector('button[aria-label="Copy"]')).toBeNull()
    })
  })
})

describe('AskUniSteps (adapter)', () => {
  let host: HTMLDivElement
  let root: Root

  async function mount(counts: Record<string, number>, lang: 'en' | 'vi' = 'en'): Promise<void> {
    const fake = fakeAdapter(lang)
    await act(async () => {
      root.render(
        h(AskUniAdapterProvider, { adapter: fake.adapter, children: h(AskUniSteps, { counts }) }),
      )
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

  it('summarizes what UNI looked at, with plural forms and the Vietnamese wording', async () => {
    await mount({ task: 24, meeting: 3, document: 1 })
    expect(host.querySelector('button')?.textContent).toContain(
      'Looked at 24 tasks, 3 meetings, 1 document',
    )
    await mount({ task: 24, meeting: 3, chat: 1 }, 'vi')
    expect(host.querySelector('button')?.textContent).toContain(
      'Đã xem 24 task, 3 cuộc họp, 1 đoạn chat',
    )
  })

  it('ignores kinds that mean nothing to a reader, and renders nothing without any', async () => {
    await mount({ member: 4, workload: 2, task: 0, document: 2 })
    expect(host.querySelector('button')?.textContent).not.toContain('member')
    await mount({ member: 4, task: 0 })
    expect(host.firstChild).toBeNull()
  })

  it('collapses to a summary and expands to the per-kind lines', async () => {
    await mount({ task: 2, meeting: 1 })
    const toggle = host.querySelector('button') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => toggle.click())
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '2 tasks',
      '1 meeting',
    ])
  })
})

describe('Ask UNI shared wording', () => {
  it('keeps the web en/vi strings for the answer, notices and errors', () => {
    expect(askUniText('en', 'askUniV2NoticeStopped')).toBe(
      'Stopped before the answer was finished.',
    )
    expect(askUniText('vi', 'askUniV2NoticeStopped')).toBe('Đã dừng trước khi trả lời xong.')
    expect(askUniText('en', 'askUniV2ErrRefused')).toBe("UNI can't answer this question.")
    expect(askUniText('vi', 'askUniV2ErrRefused')).toBe('UNI không thể trả lời câu hỏi này.')
  })

  it('has every zh key in en and vi with the same {params}', () => {
    const keys = Object.keys(askUniStrings.zh)
    expect(keys.length).toBeGreaterThan(60)
    const params = (v: string) => (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join()
    for (const k of keys) {
      const z = (askUniStrings.zh as Record<string, string>)[k]!
      for (const lang of ['en', 'vi'] as const) {
        const v = (askUniStrings[lang] as Record<string, string>)[k]
        expect(v, `${lang}.${k}`).toBeTruthy()
        expect(params(v!), `${lang}.${k}`).toBe(params(z))
      }
    }
  })
})
