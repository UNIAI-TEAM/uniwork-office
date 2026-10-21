// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { AskUniPane } from '../src/renderer/src/AskUniPane'
import { NewChatPane } from '../src/renderer/src/NewChatPane'
import { en } from '../src/renderer/src/i18n/askuni/en'
import { vi as viStrings } from '../src/renderer/src/i18n/askuni/vi'
import type {
  AskUniCitation,
  AskUniContext,
  AskUniRequest,
  AskUniResult,
} from '../src/shared/askuni-api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WS_A = { id: 'ws-a', name: 'Marketing team' }
const WS_B = { id: 'ws-b', name: 'Finance team' }

function ctx(overrides: Partial<AskUniContext> = {}): AskUniContext {
  return { workspaces: [WS_A], currentWorkspaceId: WS_A.id, signedIn: true, ...overrides }
}

function answer(
  content: string,
  extra: {
    conversationId?: string
    citations?: AskUniCitation[]
    notice?: 'no_sources' | 'empty_answer'
  } = {},
): AskUniResult {
  return {
    ok: true,
    conversationId: extra.conversationId ?? 'conv-1',
    message: {
      id: 'm-1',
      content,
      citations: extra.citations ?? [],
      ...(extra.notice ? { notice: extra.notice } : {}),
    },
  }
}

const CITATIONS: AskUniCitation[] = [
  { sourceId: 's1', kind: 'document', title: 'Q3 plan.docx', quote: 'Budget is frozen until July', href: '/o/w/documents/1' },
  { sourceId: 's2', kind: 'task', title: 'Fix invoice export', quote: 'Due Friday', href: '/o/w/tasks/2' },
  { sourceId: 's3', kind: 'meeting', title: 'Weekly sync', quote: 'We agreed to ship', href: '/o/w/meetings/3' },
  { sourceId: 's4', kind: 'chat', title: '#ops', quote: 'Server is back', href: '/o/w/chat/4' },
  { sourceId: 's5', kind: 'member', title: 'Lan Nguyen', quote: 'Finance lead', href: '/o/w/members/5' },
]

describe('Ask UNI mode (shell Home My AI)', () => {
  let host: HTMLDivElement
  let root: Root
  let ask: ReturnType<typeof vi.fn<(req: AskUniRequest) => Promise<AskUniResult>>>
  let askContext: ReturnType<typeof vi.fn<() => Promise<AskUniContext>>>
  let opened: AskUniCitation[]

  function installBridge(extra: Record<string, unknown> = {}): void {
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {
      uniworkAskUni: ask,
      uniworkAskUniContext: askContext,
      setLanguage: vi.fn(async () => undefined),
      ...extra,
    }
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
  }

  async function mount(lang: 'en' | 'vi' = 'en'): Promise<void> {
    await act(async () => {
      root.render(
        h(LocaleProvider, {
          initial: lang,
          children: h(AskUniPane, { onOpenCitation: (c: AskUniCitation) => opened.push(c) }),
        }),
      )
    })
    await flush()
  }

  const composer = () => host.querySelector('textarea') as HTMLTextAreaElement
  const sendBtn = () => host.querySelector(`button[aria-label="${en.askUniSend}"]`) as HTMLButtonElement
  const stopBtn = () => host.querySelector(`button[aria-label="${en.askUniStop}"]`) as HTMLButtonElement
  const newChatBtn = () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(en.askUniNewChat)) as
      | HTMLButtonElement
      | undefined

  async function type(value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(composer(), value)
      composer().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function sendQuestion(q: string): Promise<void> {
    await type(q)
    await act(async () => {
      sendBtn().click()
    })
    await flush()
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    opened = []
    ask = vi.fn(async () => answer('Plain answer'))
    askContext = vi.fn(async () => ctx())
    installBridge()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
  })

  describe('workspace and signed-in gate', () => {
    it('shows the current workspace name from the context', async () => {
      await mount()
      expect(host.textContent).toContain(WS_A.name)
      expect(composer()).not.toBeNull()
    })

    it('lets the user switch when the account has several workspaces', async () => {
      askContext.mockResolvedValue(ctx({ workspaces: [WS_A, WS_B] }))
      ask.mockResolvedValue(answer('From finance', { conversationId: 'conv-b' }))
      await mount()
      const select = host.querySelector('select') as HTMLSelectElement
      expect(select).not.toBeNull()
      expect([...select.options].map((o) => o.textContent)).toEqual([WS_A.name, WS_B.name])
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
        setter?.call(select, WS_B.id)
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await sendQuestion('Which budget?')
      expect(ask.mock.calls[0]![0].workspaceId).toBe(WS_B.id)
    })

    it('has no switcher with a single workspace', async () => {
      await mount()
      expect(host.querySelector('select')).toBeNull()
    })

    it('shows a signed-out note and no composer when not signed in', async () => {
      askContext.mockResolvedValue(ctx({ signedIn: false, workspaces: [], currentWorkspaceId: null }))
      await mount()
      expect(host.textContent).toContain(en.askUniSignedOut)
      expect(composer()).toBeNull()
    })

    it('says so when the account has no workspace', async () => {
      askContext.mockResolvedValue(ctx({ workspaces: [], currentWorkspaceId: null }))
      await mount()
      expect(host.textContent).toContain(en.askUniNoWorkspace)
      expect(composer()).toBeNull()
    })
  })

  describe('conversation', () => {
    it('sends {workspaceId, question, locale, conversationId} and keeps the conversation across turns', async () => {
      ask.mockResolvedValueOnce(answer('First', { conversationId: 'conv-9' }))
      ask.mockResolvedValueOnce(answer('Second', { conversationId: 'conv-9' }))
      await mount()
      await sendQuestion('  What is the plan?  ')
      expect(ask).toHaveBeenCalledTimes(1)
      expect(ask.mock.calls[0]![0]).toEqual({
        workspaceId: WS_A.id,
        question: 'What is the plan?',
        locale: 'en',
        conversationId: undefined,
      })
      await sendQuestion('And then?')
      expect(ask.mock.calls[1]![0].conversationId).toBe('conv-9')
      expect(host.textContent).toContain('First')
      expect(host.textContent).toContain('Second')
      expect(host.textContent).toContain('What is the plan?')
    })

    it('uses the vi locale in vi', async () => {
      await mount('vi')
      await type('Task nào quá hạn?')
      await act(async () => {
        ;(host.querySelector(`button[aria-label="${viStrings.askUniSend}"]`) as HTMLButtonElement).click()
      })
      await flush()
      expect(ask.mock.calls[0]![0].locale).toBe('vi')
      expect(host.textContent).toContain(viStrings.askUniTitle)
    })

    it('New chat starts a new conversation', async () => {
      ask.mockResolvedValue(answer('Answer', { conversationId: 'conv-1' }))
      await mount()
      await sendQuestion('One')
      await act(async () => {
        newChatBtn()!.click()
      })
      expect(host.textContent).not.toContain('Answer')
      await sendQuestion('Two')
      expect(ask.mock.calls[1]![0].conversationId).toBeUndefined()
    })

    it('limits the composer to 2000 chars and shows a counter near the limit only', async () => {
      await mount()
      expect(composer().maxLength).toBe(2000)
      await type('short')
      expect(host.textContent).not.toContain('5/2000')
      await type('x'.repeat(1900))
      expect(host.textContent).toContain('1900/2000')
    })

    it('does not send an empty or blank question', async () => {
      await mount()
      expect(sendBtn().disabled).toBe(true)
      await type('   ')
      expect(sendBtn().disabled).toBe(true)
      expect(ask).not.toHaveBeenCalled()
    })

    it('sends with Enter and keeps Shift+Enter for a new line', async () => {
      await mount()
      await type('Via enter')
      await act(async () => {
        composer().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
      })
      expect(ask).not.toHaveBeenCalled()
      await act(async () => {
        composer().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      await flush()
      expect(ask).toHaveBeenCalledTimes(1)
    })

    it('returns focus to the composer after send', async () => {
      await mount()
      await type('Focus me')
      await act(async () => {
        sendBtn().focus()
        sendBtn().click()
      })
      await flush()
      expect(document.activeElement).toBe(composer())
    })

    it('keeps a single polite live region for the answers', async () => {
      await mount()
      expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
      expect(host.querySelector('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
      await sendQuestion('Hello')
      expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
      expect(host.querySelectorAll('[role="alert"],[role="status"]')).toHaveLength(0)
    })
  })

  describe('pending and stop', () => {
    it('shows pending with a Stop that drops the answer locally', async () => {
      let resolveAsk: (r: AskUniResult) => void = () => undefined
      ask.mockImplementation(
        () =>
          new Promise<AskUniResult>((res) => {
            resolveAsk = res
          }),
      )
      await mount()
      await sendQuestion('Slow one')
      expect(host.textContent).toContain(en.askUniThinking)
      expect(stopBtn()).not.toBeNull()
      expect(sendBtn()).toBeNull()
      await act(async () => {
        stopBtn().click()
      })
      expect(host.textContent).not.toContain(en.askUniThinking)
      expect(host.textContent).toContain(en.askUniStopped)
      await act(async () => {
        resolveAsk(answer('Late answer'))
      })
      await flush()
      expect(host.textContent).not.toContain('Late answer')
      expect(sendBtn()).not.toBeNull()
    })

    it('drops a late answer after New chat as well', async () => {
      let resolveAsk: (r: AskUniResult) => void = () => undefined
      ask.mockImplementation(
        () =>
          new Promise<AskUniResult>((res) => {
            resolveAsk = res
          }),
      )
      await mount()
      await sendQuestion('Slow one')
      await act(async () => {
        newChatBtn()!.click()
      })
      await act(async () => {
        resolveAsk(answer('Ghost answer', { conversationId: 'conv-old' }))
      })
      await flush()
      expect(host.textContent).not.toContain('Ghost answer')
      ask.mockResolvedValue(answer('Fresh'))
      await sendQuestion('Next')
      expect(ask.mock.calls[1]![0].conversationId).toBeUndefined()
    })
  })

  describe('answer and sources', () => {
    it('renders the answer as safe Markdown (no raw HTML)', async () => {
      ask.mockResolvedValue(
        answer('The **budget** is frozen.\n\n<img src=x onerror="alert(1)"><script>alert(2)</script>'),
      )
      await mount()
      await sendQuestion('Budget?')
      expect(host.querySelector('strong')?.textContent).toBe('budget')
      expect(host.querySelector('img')).toBeNull()
      expect(host.querySelector('script')).toBeNull()
      expect(host.textContent).toContain('<img src=x')
    })

    it('lists sources under the answer: one button row per citation with kind icon, title and quote', async () => {
      ask.mockResolvedValue(answer('See sources', { citations: CITATIONS }))
      await mount()
      await sendQuestion('Where?')
      const list = host.querySelector(`[aria-label="${en.askUniSources}"]`) as HTMLElement
      expect(list).not.toBeNull()
      expect(list.textContent).toContain(en.askUniSources) // visible heading too
      const rows = [...host.querySelectorAll('.askuni-source')] as HTMLButtonElement[]
      expect(rows).toHaveLength(5)
      for (const [i, row] of rows.entries()) {
        const c = CITATIONS[i]!
        expect(row.tagName).toBe('BUTTON')
        expect(row.getAttribute('data-kind')).toBe(c.kind)
        expect(row.querySelector('svg')).not.toBeNull()
        expect(row.textContent).toContain(c.title)
        expect(row.textContent).toContain(c.quote)
        const name = row.getAttribute('aria-label') ?? ''
        expect(name).toContain(c.title)
      }
      expect(rows[0]!.getAttribute('aria-label')).toContain(en.askUniKindDocument)
      expect(rows[1]!.getAttribute('aria-label')).toContain(en.askUniKindTask)
      expect(rows[2]!.getAttribute('aria-label')).toContain(en.askUniKindMeeting)
      expect(rows[3]!.getAttribute('aria-label')).toContain(en.askUniKindChat)
      expect(rows[4]!.getAttribute('aria-label')).toContain(en.askUniKindMember)
    })

    it('document rows say open document, other kinds say open in browser', async () => {
      ask.mockResolvedValue(answer('See sources', { citations: CITATIONS }))
      await mount()
      await sendQuestion('Where?')
      const rows = [...host.querySelectorAll('.askuni-source')]
      expect(rows[0]!.textContent).toContain(en.askUniOpenDocument)
      expect(rows[0]!.textContent).not.toContain(en.askUniOpenBrowser)
      for (const row of rows.slice(1)) {
        expect(row.textContent).toContain(en.askUniOpenBrowser)
        expect(row.textContent).not.toContain(en.askUniOpenDocument)
      }
    })

    it('every row calls onOpenCitation with its citation', async () => {
      ask.mockResolvedValue(answer('See sources', { citations: CITATIONS }))
      await mount()
      await sendQuestion('Where?')
      const rows = [...host.querySelectorAll('.askuni-source')] as HTMLButtonElement[]
      for (const row of rows) {
        await act(async () => {
          row.click()
        })
      }
      expect(opened).toEqual(CITATIONS)
    })

    it('shows no source list for an answer without citations', async () => {
      await mount()
      await sendQuestion('Hello')
      expect(host.querySelector('.askuni-source')).toBeNull()
      expect(host.querySelector(`[aria-label="${en.askUniSources}"]`)).toBeNull()
    })
  })

  describe('states', () => {
    it('empty: no_sources notice', async () => {
      ask.mockResolvedValue(answer('', { notice: 'no_sources' }))
      await mount()
      await sendQuestion('Anything?')
      expect(host.textContent).toContain(en.askUniNoticeNoSources)
    })

    it('empty_answer: unavailable notice', async () => {
      ask.mockResolvedValue(answer('', { notice: 'empty_answer' }))
      await mount()
      await sendQuestion('Anything?')
      expect(host.textContent).toContain(en.askUniNoticeUnavailable)
    })

    it.each([
      ['forbidden', en.askUniErrForbidden],
      ['quota', en.askUniErrQuota],
      ['rate_limited', en.askUniErrRateLimited],
      ['disabled', en.askUniErrDisabled],
      ['offline', en.askUniErrOffline],
      ['session', en.askUniErrSession],
      ['error', en.askUniErrDefault],
    ] as const)('error %s shows its copy and leaves the composer usable', async (code, copy) => {
      ask.mockResolvedValue({ ok: false, code })
      await mount()
      await sendQuestion('Question that fails')
      expect(host.textContent).toContain(copy)
      expect(host.textContent).not.toContain(en.askUniThinking)
      expect(sendBtn()).not.toBeNull()
      expect(composer().disabled).toBe(false)
    })

    it('rate_limited with retry seconds names the wait', async () => {
      ask.mockResolvedValue({ ok: false, code: 'rate_limited', retryAfterSec: 42 })
      await mount()
      await sendQuestion('Too fast')
      expect(host.textContent).toContain(en.askUniErrRateLimitedIn.replace('{seconds}', '42'))
    })

    it('signed_out from the server flips to the signed-out note', async () => {
      ask.mockResolvedValue({ ok: false, code: 'signed_out' })
      await mount()
      await sendQuestion('Hello')
      expect(host.textContent).toContain(en.askUniSignedOut)
    })

    it('a rejected bridge call is a generic error, not a crash', async () => {
      ask.mockRejectedValue(new Error('ipc broke'))
      await mount()
      await sendQuestion('Hello')
      expect(host.textContent).toContain(en.askUniErrDefault)
      expect(host.textContent).not.toContain('ipc broke')
    })

    it('an error puts the question back into the empty composer', async () => {
      ask.mockResolvedValue({ ok: false, code: 'offline' })
      await mount()
      await sendQuestion('Retry me')
      expect(composer().value).toBe('Retry me')
    })
  })

  describe('My AI pane wiring', () => {
    const noop = async () => null
    function chatBridge(): Record<string, unknown> {
      return new Proxy(
        {
          uniworkAskUni: ask,
          uniworkAskUniContext: askContext,
          recents: async () => ({ items: [], total: 0 }),
          setLanguage: noop,
        } as Record<string, unknown>,
        {
          get: (t, p: string) => (p in t ? t[p] : undefined),
        },
      )
    }

    async function mountPane(): Promise<void> {
      ;(window as unknown as { aiOffice: unknown }).aiOffice = chatBridge()
      await act(async () => {
        root.render(
          h(LocaleProvider, {
            initial: 'en',
            children: h(NewChatPane, { practiceId: 'general' as never, ensureWorkbench: () => undefined }),
          }),
        )
      })
      await flush()
    }

    const modeBtn = (label: string) =>
      [...host.querySelectorAll('.new-chat-bar button')].find((b) => b.textContent?.trim() === label) as
        | HTMLButtonElement
        | undefined

    it('adds a keyboard-reachable mode toggle next to the chat and switches to Ask UNI', async () => {
      await mountPane()
      const chat = modeBtn(en.askUniModeChat)
      const askMode = modeBtn(en.askUniModeAsk)
      expect(chat).toBeDefined()
      expect(askMode).toBeDefined()
      expect(chat!.getAttribute('aria-pressed')).toBe('true')
      expect(askMode!.getAttribute('aria-pressed')).toBe('false')
      expect(chat!.tabIndex).toBeGreaterThanOrEqual(0)
      expect(askMode!.tabIndex).toBeGreaterThanOrEqual(0)
      expect(host.querySelector('.askuni-pane')).toBeNull()
      await act(async () => {
        askMode!.click()
      })
      await flush()
      expect(host.querySelector('.askuni-pane')).not.toBeNull()
      expect(askMode!.getAttribute('aria-pressed')).toBe('true')
      expect(host.textContent).toContain(WS_A.name)
      await act(async () => {
        chat!.click()
      })
      expect(host.querySelector('.askuni-pane')).toBeNull()
    })

    it('hides the toggle when the shell bridge has no Ask UNI', async () => {
      ;(window as unknown as { aiOffice: unknown }).aiOffice = new Proxy(
        { recents: async () => ({ items: [], total: 0 }) } as Record<string, unknown>,
        { get: (t, p: string) => t[p] },
      )
      await act(async () => {
        root.render(
          h(LocaleProvider, {
            initial: 'en',
            children: h(NewChatPane, { practiceId: 'general' as never, ensureWorkbench: () => undefined }),
          }),
        )
      })
      await flush()
      expect(modeBtn(en.askUniModeAsk)).toBeUndefined()
    })
  })
})
