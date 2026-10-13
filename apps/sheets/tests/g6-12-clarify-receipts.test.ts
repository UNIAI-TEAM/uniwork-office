// @vitest-environment jsdom
// G6-12 (UNI-1366) F1: after the user answers an ask_clarification card, the sheets panel keeps
// a styled "answered" receipt under the user message (html/pdf/slides do), so the chat does
// not lose the answers. A skip leaves no receipt; the receipt is view-only chat state that is
// dropped with its workbook (switch), when restored history lands, and with New chat (the chat
// array is emptied). App.tsx owns the chat, so its wiring is pinned by source checks.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AiChatPanel, type AiChatMessage } from '../src/renderer/ai/AiChatPanel'
import { withReceipt, withoutReceipts } from '../src/renderer/ai/clarify-receipts'
import { LocaleProvider } from '../src/renderer/i18n/locale'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const user = (text: string): AiChatMessage => ({ role: 'user', text, tools: [] })
const assistant = (text: string): AiChatMessage => ({ role: 'assistant', text, tools: [] })
const QA = [{ q: 'Which column?', a: 'Net revenue' }]

describe('receipt helpers', () => {
  it('attaches an answered card to the newest user message only', () => {
    const chat = [user('a'), assistant('x'), user('b'), assistant('y')]
    const next = withReceipt(chat, QA)
    expect(next[0]).toBe(chat[0])
    expect(next[2]!.clarifyReceipts).toEqual([QA])
    expect(next[3]).toBe(chat[3])
  })

  it('accumulates a second card of the same run and ignores an empty answer', () => {
    const once = withReceipt([user('a')], QA)
    expect(withReceipt(once, QA)[0]!.clarifyReceipts).toHaveLength(2)
    expect(withReceipt(once, [])).toBe(once)
  })

  it('drops every receipt, and returns the same array when there is none', () => {
    const chat = [user('a')]
    expect(withoutReceipts(chat)).toBe(chat)
    const stripped = withoutReceipts(withReceipt(chat, QA))
    expect(stripped[0]).toEqual(user('a'))
    expect('clarifyReceipts' in stripped[0]!).toBe(false)
  })
})

describe('AiChatPanel receipts', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    vi.unstubAllGlobals()
  })

  function mount(chat: readonly AiChatMessage[], clarify: any = null) {
    vi.stubGlobal(
      'desktopApi',
      new Proxy(
        {},
        {
          get: (_target, prop: string) =>
            /^on[A-Z]/.test(prop) ? () => () => {} : () => Promise.resolve(undefined),
        },
      ),
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en', children: null },
          createElement(AiChatPanel, {
            isOpen: true,
            hasContent: true,
            chat,
            attachments: [],
            attachNotice: null,
            onPickAttachments: () => {},
            onAddAttachmentPaths: () => {},
            onAddPastedImage: () => {},
            onRemoveAttachment: () => {},
            prompt: '',
            preview: null,
            aiBusy: false,
            onPromptChange: () => {},
            onSend: () => {},
            onStop: () => {},
            onNewChat: () => {},
            onUndo: () => {},
            scopeRange: null,
            scopeColumns: null,
            scopeLocked: false,
            onScopeDismiss: () => {},
            onCitation: () => {},
            onExpand: () => {},
            onCollapse: () => {},
            clarify,
          }),
        ),
      ),
    )
    return container
  }

  it('renders the receipt under its user message, and none for a message without one', () => {
    const c = mount([withReceipt([user('fix it')], QA)[0]!, assistant('done'), user('again')])
    const receipts = c.querySelectorAll('.ai-clarify-answered')
    expect(receipts).toHaveLength(1)
    const bubbles = c.querySelectorAll('.ai-msg-user')
    expect(bubbles[0]!.contains(receipts[0]!)).toBe(true)
    expect(bubbles[1]!.querySelector('.ai-clarify-answered')).toBeNull()
    expect(receipts[0]!.textContent).toContain('Which column?')
    expect(receipts[0]!.textContent).toContain('Net revenue')
  })

  it('hands the structured answers to the host when the card is submitted', () => {
    const onSubmit = vi.fn()
    const c = mount([user('fix it')], {
      questions: [{ id: 'z', label: 'Which column?', options: ['Net revenue', 'Tax'] }],
      onSubmit,
      onSkip: () => {},
    })
    vi.useFakeTimers()
    try {
      act(() => c.querySelector<HTMLElement>('.ai-clarify-opt')!.click())
      act(() => {
        vi.advanceTimersByTime(400)
      })
    } finally {
      vi.useRealTimers()
    }
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![1]).toEqual([{ q: 'Which column?', a: 'Net revenue' }])
  })
})

describe('App wiring', () => {
  const app = read('src/renderer/App.tsx')

  it('attaches the receipt on submit and never on skip', () => {
    expect(app).toMatch(
      /onSubmit: \(answers, qa\) => \{\s*setChat\(\(previous\) => withReceipt\(previous, qa\)\)\s*settleClarify\(\{ answers \}\)/,
    )
    expect(app).toMatch(/onSkip: \(\) => settleClarify\(\{ answers: '', cancelled: true \}\)/)
  })

  it('drops the receipts when another workbook opens (not on a same-conversation save)', () => {
    expect(app).toMatch(
      /if \(!continues\) \{\s*setHistoricChat\(\[\]\)\s*(?:\/\/[^\n]*\s*)?setChat\(withoutReceipts\)/,
    )
  })

  it('drops the receipts when restored history lands', () => {
    expect(app).toMatch(
      /if \(stale\(\) \|\| msgs\.length === 0\) return\s*(?:\/\/[^\n]*\s*)?setChat\(withoutReceipts\)/,
    )
  })
})
