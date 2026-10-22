// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/askuni/en'
import { vi as viStrings } from '../src/renderer/src/i18n/askuni/vi'
import { ASKUNI_MODEL_KEY } from '../src/renderer/src/askuni-v2/model-choice'
import type {
  AskUniCapabilitiesResult,
  AskUniConversation,
  AskUniConversationsResult,
  AskUniMessagesResult,
  AskUniOkResult,
} from '../src/shared/askuni-api'

// S3 owns the stream hook and the thread: the panel is tested against their agreed shapes.
const mocks = vi.hoisted(() => {
  const stream = {
    state: { status: 'idle' as string, conversationId: null as string | null },
    ask: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }
  const threadProps: { current: Record<string, unknown> | null } = { current: null }
  const hookArgs: { current: unknown } = { current: null }
  return { stream, threadProps, hookArgs }
})
vi.mock('../src/renderer/src/askuni-v2/use-ask-uni-stream', () => ({
  useAskUniStream: (args: unknown) => {
    mocks.hookArgs.current = args
    return mocks.stream
  },
}))
vi.mock('../src/renderer/src/askuni-v2/AskUniThread', async () => {
  const { createElement } = await import('react')
  return {
    AskUniThread: (props: Record<string, unknown>) => {
      mocks.threadProps.current = props
      return createElement(
        'div',
        { 'data-testid': 'thread' },
        `thread:${String(props.conversationId)}`,
      )
    },
  }
})
import { AskUniPanel } from '../src/renderer/src/askuni-v2/AskUniPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONVS: AskUniConversation[] = [
  {
    id: 'c1',
    title: 'Overdue tasks',
    createdAt: '2026-10-20T01:00:00Z',
    updatedAt: '2026-10-20T02:00:00Z',
  },
  {
    id: 'c2',
    title: 'Budget review',
    createdAt: '2026-10-19T01:00:00Z',
    updatedAt: '2026-10-19T02:00:00Z',
  },
]

describe('Ask UNI v2 panel', () => {
  let host: HTMLDivElement
  let root: Root
  let capabilities: ReturnType<typeof vi.fn<() => Promise<AskUniCapabilitiesResult>>>
  let conversations: ReturnType<typeof vi.fn<() => Promise<AskUniConversationsResult>>>
  let messages: ReturnType<typeof vi.fn<() => Promise<AskUniMessagesResult>>>
  let feedbackSet: ReturnType<typeof vi.fn<() => Promise<AskUniOkResult>>>
  let feedbackClear: ReturnType<typeof vi.fn<() => Promise<AskUniOkResult>>>

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
  }
  async function mount(
    props: Partial<Parameters<typeof AskUniPanel>[0]> = {},
    lang: 'en' | 'vi' = 'en',
  ): Promise<void> {
    await act(async () => {
      root.render(
        h(LocaleProvider, {
          initial: lang,
          children: h(AskUniPanel, { workspaceId: 'ws-1', ...props }),
        }),
      )
    })
    await flush()
  }
  const hookArgs = () =>
    mocks.hookArgs.current as {
      workspaceId: string
      onConversation?: (id: string) => void
      onSettled?: () => void
    }
  async function adopt(id: string): Promise<void> {
    await act(async () => hookArgs().onConversation?.(id))
    await flush()
  }
  const box = () => host.querySelector('textarea') as HTMLTextAreaElement
  const thread = () => host.querySelector('[data-testid="thread"]')
  const trigger = () => host.querySelector('button.askuni2-title-btn') as HTMLButtonElement
  async function typeAndSend(q: string): Promise<void> {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box(), q)
      box().dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      box().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
    })
  }
  async function openHistory(): Promise<void> {
    await act(async () => trigger().click())
    await flush()
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    localStorage.clear()
    mocks.stream.state = { status: 'idle', conversationId: null }
    mocks.stream.ask.mockReset()
    mocks.stream.stop.mockReset()
    mocks.stream.reset.mockReset()
    mocks.threadProps.current = null
    capabilities = vi.fn(async () => ({
      ok: true as const,
      enabled: true,
      autoModel: 'sonnet',
      models: [
        { key: 'haiku' as const, speed: 5, intelligence: 2, cost: 1, enabled: true },
        { key: 'sonnet' as const, speed: 4, intelligence: 4, cost: 3, enabled: true },
        { key: 'opus' as const, speed: 2, intelligence: 5, cost: 5, enabled: false },
      ],
    }))
    conversations = vi.fn(async () => ({ ok: true as const, conversations: [...CONVS] }))
    messages = vi.fn(async () => ({ ok: true as const, messages: [] }))
    feedbackSet = vi.fn(async () => ({ ok: true as const }))
    feedbackClear = vi.fn(async () => ({ ok: true as const }))
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {
      askUniCapabilities: capabilities,
      askUniConversations: conversations,
      askUniMessages: messages,
      askUniFeedbackSet: feedbackSet,
      askUniFeedbackClear: feedbackClear,
      askUniLookup: vi.fn(async () => ({ ok: true as const, items: [] })),
      askUniRename: vi.fn(async () => ({ ok: true as const })),
      askUniDelete: vi.fn(async () => ({ ok: true as const })),
      setLanguage: vi.fn(async () => undefined),
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
  })

  describe('frame', () => {
    it('composes the header, the thread and the composer for the workspace', async () => {
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      await mount()
      await adopt('c1')
      expect(trigger()).not.toBeNull()
      expect(thread()).not.toBeNull()
      expect(box()).not.toBeNull()
      expect(host.querySelector('section[aria-label]')?.getAttribute('aria-label')).toBe(
        en.askUniTitle,
      )
    })

    it('hands the thread its props: workspace, conversation, loader, stream and the two callbacks', async () => {
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      await mount()
      await adopt('c1')
      const p = mocks.threadProps.current!
      expect(p.workspaceId).toBe('ws-1')
      expect(p.conversationId).toBe('c1')
      expect(p.stream).toBe(mocks.stream)
      expect(typeof p.loadMessages).toBe('function')
      expect(typeof p.onRegenerate).toBe('function')
      // feedback is S3's default (the bridge), the panel does not pass one
      expect(p.onFeedback).toBeUndefined()
    })

    it('loadMessages is the bridge messages call, result passed through', async () => {
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      const reply = { ok: true as const, messages: [] }
      messages.mockResolvedValue(reply)
      await mount()
      const load = mocks.threadProps.current!.loadMessages as (id: string) => Promise<unknown>
      await expect(load('c1')).resolves.toBe(reply)
      expect(messages).toHaveBeenCalledWith({ conversationId: 'c1' })
      expect((mocks.hookArgs.current as { workspaceId: string }).workspaceId).toBe('ws-1')
      expect('loadMessages' in (mocks.hookArgs.current as object)).toBe(false)
    })

    it('onRegenerate resends the question in the open conversation, without focus or mentions', async () => {
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      await mount()
      await adopt('c1')
      const regenerate = mocks.threadProps.current!.onRegenerate as (q: string) => void
      regenerate('Which tasks are overdue?')
      expect(mocks.stream.ask).toHaveBeenCalledTimes(1)
      const req = mocks.stream.ask.mock.calls[0]![0]
      expect(req).toMatchObject({
        question: 'Which tasks are overdue?',
        conversationId: 'c1',
        locale: 'en',
      })
      expect(req.focus).toBeUndefined()
      expect(req.mentions).toBeUndefined()
    })

    it('can be hidden without unmounting', async () => {
      await mount({ visible: false })
      expect(host.querySelector('section')?.hasAttribute('hidden')).toBe(true)
      await mount({ visible: true })
      expect(host.querySelector('section')?.hasAttribute('hidden')).toBe(false)
    })
  })

  describe('empty state', () => {
    it('shows the web empty state with three suggestions for a new idle conversation', async () => {
      await mount()
      expect(thread()).toBeNull()
      expect(host.textContent).toContain(en.askUniEmptyTitle)
      expect(host.textContent).toContain(en.askUniEmptyDescription)
      const buttons = [...host.querySelectorAll('[data-slot="askuni-suggestions"] button')]
      expect(buttons.map((b) => b.textContent)).toEqual([
        en.askUniV2SuggestionOverdue,
        en.askUniV2SuggestionMeetings,
        en.askUniV2SuggestionChat,
      ])
    })

    it('a suggestion click sends it as a new question', async () => {
      await mount()
      const first = host.querySelector(
        '[data-slot="askuni-suggestions"] button',
      ) as HTMLButtonElement
      await act(async () => first.click())
      expect(mocks.stream.ask).toHaveBeenCalledTimes(1)
      const req = mocks.stream.ask.mock.calls[0]![0]
      expect(req.question).toBe(en.askUniV2SuggestionOverdue)
      expect(req.conversationId).toBeUndefined()
      expect(req.locale).toBe('en')
    })

    it('uses the Vietnamese suggestions and locale', async () => {
      await mount({}, 'vi')
      expect(host.textContent).toContain(viStrings.askUniV2SuggestionOverdue)
      expect(viStrings.askUniV2SuggestionOverdue).toBe('Task nào quá hạn?')
      const first = host.querySelector(
        '[data-slot="askuni-suggestions"] button',
      ) as HTMLButtonElement
      await act(async () => first.click())
      expect(mocks.stream.ask.mock.calls[0]![0].locale).toBe('vi')
    })

    it('is replaced by the thread as soon as a turn is running', async () => {
      await mount()
      mocks.stream.state = { status: 'streaming', conversationId: null }
      await mount()
      expect(thread()).not.toBeNull()
      expect(host.textContent).not.toContain(en.askUniEmptyTitle)
    })

    it('is not shown for an opened conversation', async () => {
      await mount()
      await openHistory()
      const pick = host.querySelector('[data-slot="askuni-history"] li button') as HTMLButtonElement
      await act(async () => pick.click())
      await flush()
      expect(host.textContent).not.toContain(en.askUniEmptyTitle)
      expect(thread()).not.toBeNull()
    })
  })

  describe('conversation id', () => {
    it('opening one from the history resets the stream and shows it in the thread', async () => {
      await mount()
      await openHistory()
      const second = host
        .querySelectorAll('[data-slot="askuni-history"] li')[1]!
        .querySelector('button') as HTMLButtonElement
      await act(async () => second.click())
      await flush()
      expect(mocks.stream.reset).toHaveBeenCalled()
      expect(mocks.threadProps.current!.conversationId).toBe('c2')
      expect(trigger().textContent).toContain('Budget review')
    })

    it('New conversation drops the id and resets the stream', async () => {
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      await mount()
      await adopt('c1')
      mocks.stream.state = { status: 'idle', conversationId: null }
      const btn = host.querySelector(
        `button[aria-label="${en.askUniV2NewConversation}"]`,
      ) as HTMLElement
      await act(async () => btn.click())
      await flush()
      expect(mocks.stream.reset).toHaveBeenCalled()
      expect(thread()).toBeNull()
      expect(host.textContent).toContain(en.askUniEmptyTitle)
    })

    it('adopts the id the server gave a new conversation (onConversation)', async () => {
      await mount()
      expect(host.textContent).toContain(en.askUniEmptyTitle)
      mocks.stream.state = { status: 'streaming', conversationId: 'c-new' }
      await act(async () => hookArgs().onConversation?.('c-new'))
      await flush()
      expect(mocks.threadProps.current!.conversationId).toBe('c-new')
      expect(trigger().textContent).toContain(en.askUniV2Untitled)
    })

    it('sends follow-up questions into the same conversation', async () => {
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      await mount()
      await adopt('c1')
      await typeAndSend('And next week?')
      expect(mocks.stream.ask.mock.calls[0]![0]).toMatchObject({
        question: 'And next week?',
        conversationId: 'c1',
      })
    })

    it('a workspace switch starts a new conversation', async () => {
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      await mount({ workspaceId: 'ws-1' })
      await adopt('c1')
      mocks.stream.state = { status: 'idle', conversationId: null }
      mocks.stream.reset.mockClear()
      await mount({ workspaceId: 'ws-2' })
      expect(mocks.stream.reset).toHaveBeenCalled()
      expect((mocks.hookArgs.current as { workspaceId: string }).workspaceId).toBe('ws-2')
      expect(host.textContent).toContain(en.askUniEmptyTitle)
    })

    it('reloads the history when a turn settles (onSettled)', async () => {
      mocks.stream.state = { status: 'streaming', conversationId: 'c1' }
      await mount()
      const before = conversations.mock.calls.length
      await act(async () => hookArgs().onSettled?.())
      await flush()
      expect(conversations.mock.calls.length).toBe(before + 1)
    })

    it('reloads the history when a new conversation is named', async () => {
      await mount()
      const before = conversations.mock.calls.length
      await act(async () => hookArgs().onConversation?.('c-new'))
      await flush()
      expect(conversations.mock.calls.length).toBe(before + 1)
    })
  })

  describe('model choice reaches the request', () => {
    it('sends nothing for Auto', async () => {
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      await mount()
      await adopt('c1')
      await typeAndSend('hi')
      const req = mocks.stream.ask.mock.calls[0]![0]
      expect(req.model ?? '').toBe('')
      expect(req.effort).toBeUndefined()
    })

    it('sends the stored model and effort', async () => {
      localStorage.setItem(ASKUNI_MODEL_KEY, JSON.stringify({ model: 'haiku', effort: 'high' }))
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      await mount()
      await adopt('c1')
      await typeAndSend('hi')
      expect(capabilities).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
      expect(mocks.stream.ask.mock.calls[0]![0]).toMatchObject({ model: 'haiku', effort: 'high' })
    })

    it('a stored model the organization has switched off is sent as Auto', async () => {
      localStorage.setItem(ASKUNI_MODEL_KEY, JSON.stringify({ model: 'opus', effort: 'low' }))
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      await mount()
      await adopt('c1')
      await typeAndSend('hi')
      const req = mocks.stream.ask.mock.calls[0]![0]
      expect(req.model ?? '').toBe('')
      expect(req.effort).toBe('low')
    })

    it('a suggestion uses the chosen model too', async () => {
      localStorage.setItem(ASKUNI_MODEL_KEY, JSON.stringify({ model: 'sonnet', effort: '' }))
      await mount()
      const first = host.querySelector(
        '[data-slot="askuni-suggestions"] button',
      ) as HTMLButtonElement
      await act(async () => first.click())
      expect(mocks.stream.ask.mock.calls[0]![0].model).toBe('sonnet')
    })

    it('picking a model in the picker is remembered per account (stored under the AI key)', async () => {
      mocks.stream.state = { status: 'done', conversationId: 'c1' }
      await mount()
      await adopt('c1')
      await act(async () =>
        (host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement).click(),
      )
      const haiku = [...host.querySelectorAll('[role="menuitemradio"]')].find((r) =>
        r.textContent?.includes(en.askUniV2ModelHaiku),
      ) as HTMLElement
      await act(async () => haiku.click())
      expect(JSON.parse(localStorage.getItem(ASKUNI_MODEL_KEY) ?? '{}').model).toBe('haiku')
      await typeAndSend('hi')
      expect(mocks.stream.ask.mock.calls[0]![0].model).toBe('haiku')
    })
  })

  describe('document entry', () => {
    it('passes a pending focus to the composer once', async () => {
      const consumed = vi.fn()
      await mount({
        pendingFocus: { kind: 'document', id: 'doc-7', label: 'Q3 plan.docx' },
        onPendingFocusConsumed: consumed,
      })
      expect(host.querySelector('[data-chip="focus"]')?.textContent).toContain('Q3 plan.docx')
      expect(consumed).toHaveBeenCalledTimes(1)
    })

    it('a workspace switch drops the scope chip, so it is never sent to the other workspace', async () => {
      await mount({ pendingFocus: { kind: 'document', id: 'doc-7', label: 'Q3 plan.docx' } })
      expect(host.querySelector('[data-chip="focus"]')).not.toBeNull()
      await mount({ workspaceId: 'ws-2' })
      expect(host.querySelector('[data-chip="focus"]')).toBeNull()
      await typeAndSend('hi')
      expect(mocks.stream.ask.mock.calls[0]![0]).not.toHaveProperty('focus')
    })
  })
})
