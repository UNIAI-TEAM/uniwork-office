// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { AskUniPane } from '../src/renderer/src/AskUniPane'
import { NewChatPane } from '../src/renderer/src/NewChatPane'
import { en } from '../src/renderer/src/i18n/askuni/en'
import { en as settingsEn } from '../src/renderer/src/i18n/settings/en'
import { vi as viStrings } from '../src/renderer/src/i18n/askuni/vi'
import type {
  AskUniCitation,
  AskUniContext,
  AskUniOpenRequest,
  AskUniOpenResult,
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
  {
    sourceId: 's1',
    kind: 'document',
    title: 'Q3 plan.docx',
    quote: 'Budget is frozen until July',
    href: '/o/w/documents/1',
  },
  {
    sourceId: 's2',
    kind: 'task',
    title: 'Fix invoice export',
    quote: 'Due Friday',
    href: '/o/w/tasks/2',
  },
  {
    sourceId: 's3',
    kind: 'meeting',
    title: 'Weekly sync',
    quote: 'We agreed to ship',
    href: '/o/w/meetings/3',
  },
  { sourceId: 's4', kind: 'chat', title: '#ops', quote: 'Server is back', href: '/o/w/chat/4' },
  {
    sourceId: 's5',
    kind: 'member',
    title: 'Lan Nguyen',
    quote: 'Finance lead',
    href: '/o/w/members/5',
  },
]

describe('Ask UNI mode (shell Home My AI)', () => {
  let host: HTMLDivElement
  let root: Root
  let ask: ReturnType<typeof vi.fn<(req: AskUniRequest) => Promise<AskUniResult>>>
  let askContext: ReturnType<typeof vi.fn<() => Promise<AskUniContext>>>
  let openCitation: ReturnType<typeof vi.fn<(req: AskUniOpenRequest) => Promise<AskUniOpenResult>>>

  function installBridge(extra: Record<string, unknown> = {}): void {
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {
      uniworkAskUni: ask,
      uniworkAskUniContext: askContext,
      uniworkAskUniOpenCitation: openCitation,
      setLanguage: vi.fn(async () => undefined),
      ...extra,
    }
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
  }

  async function mount(lang: 'en' | 'vi' = 'en', props: { visible?: boolean } = {}): Promise<void> {
    await act(async () => {
      root.render(
        h(LocaleProvider, {
          initial: lang,
          children: h(AskUniPane, props),
        }),
      )
    })
    await flush()
  }

  const composer = () => host.querySelector('textarea') as HTMLTextAreaElement
  const sendBtn = () =>
    host.querySelector(`button[aria-label="${en.askUniSend}"]`) as HTMLButtonElement
  const stopBtn = () =>
    host.querySelector(`button[aria-label="${en.askUniStop}"]`) as HTMLButtonElement
  const newChatBtn = () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(en.askUniNewChat)) as
      HTMLButtonElement | undefined

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
    openCitation = vi.fn(async () => ({ ok: true as const }))
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
      askContext.mockResolvedValue(
        ctx({ signedIn: false, workspaces: [], currentWorkspaceId: null }),
      )
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
        ;(
          host.querySelector(`button[aria-label="${viStrings.askUniSend}"]`) as HTMLButtonElement
        ).click()
      })
      await flush()
      expect(ask.mock.calls[0]![0].locale).toBe('vi')
      expect(host.querySelector(`[aria-label="${viStrings.askUniTitle}"]`)).not.toBeNull()
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
        composer().dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
        )
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

    it('disables the composer while an ask is pending; Stop stays enabled and Enter does nothing', async () => {
      let resolveAsk: (r: AskUniResult) => void = () => undefined
      ask.mockImplementation(
        () =>
          new Promise<AskUniResult>((res) => {
            resolveAsk = res
          }),
      )
      await mount()
      await sendQuestion('Slow one')
      expect(composer().disabled).toBe(true)
      expect(stopBtn().disabled).toBe(false)
      expect(sendBtn()).toBeNull()
      await act(async () => {
        composer().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(ask).toHaveBeenCalledTimes(1)
      await act(async () => {
        resolveAsk(answer('Done'))
      })
      await flush()
      expect(composer().disabled).toBe(false)
      expect(document.activeElement).toBe(composer())
    })

    it('moves focus to Stop when a question is sent', async () => {
      ask.mockImplementation(() => new Promise<AskUniResult>(() => undefined))
      await mount()
      await sendQuestion('Slow one')
      expect(stopBtn()).not.toBeNull()
      expect(document.activeElement).toBe(stopBtn())
    })

    it('does not pull focus back to the composer when it moved elsewhere while pending', async () => {
      ask.mockResolvedValueOnce(answer('First', { citations: [CITATIONS[0]!] }))
      await mount()
      await sendQuestion('First question')
      let resolveAsk: (r: AskUniResult) => void = () => undefined
      ask.mockImplementationOnce(
        () =>
          new Promise<AskUniResult>((res) => {
            resolveAsk = res
          }),
      )
      await sendQuestion('Second question')
      const row = host.querySelector('.askuni-source') as HTMLButtonElement
      await act(async () => {
        row.focus()
      })
      expect(document.activeElement).toBe(row)
      await act(async () => {
        resolveAsk(answer('Second'))
      })
      await flush()
      expect(document.activeElement).toBe(row)
    })

    it('re-enables the composer and focuses it after Stop', async () => {
      ask.mockImplementation(() => new Promise<AskUniResult>(() => undefined))
      await mount()
      await sendQuestion('Never answers')
      expect(composer().disabled).toBe(true)
      await act(async () => {
        stopBtn().click()
      })
      await flush()
      expect(composer().disabled).toBe(false)
      expect(document.activeElement).toBe(composer())
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
        answer(
          'The **budget** is frozen.\n\n<img src=x onerror="alert(1)"><script>alert(2)</script>',
        ),
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

    it('shows each citation sourceId as a prefix so [Sn] in the answer can be matched', async () => {
      const marked: AskUniCitation[] = [
        { ...CITATIONS[0]!, sourceId: 'S1' },
        { ...CITATIONS[1]!, sourceId: 'S2' },
        { sourceId: 'S3', kind: 'other', title: 'Phoenix', quote: '', href: '' },
      ]
      ask.mockResolvedValue(answer('Budget is frozen [S1]', { citations: marked }))
      await mount()
      await sendQuestion('Where?')
      const rows = [...host.querySelectorAll('.askuni-source')] as HTMLElement[]
      expect(rows.map((r) => r.querySelector('.askuni-source-id')?.textContent)).toEqual([
        'S1',
        'S2',
        'S3',
      ])
      expect(rows[0]!.textContent).toContain('S1')
      // the accessible name stays kind + title first
      expect(rows[0]!.getAttribute('aria-label')?.startsWith(en.askUniKindDocument)).toBe(true)
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

    it('every row calls the open bridge with its kind and href only', async () => {
      ask.mockResolvedValue(answer('See sources', { citations: CITATIONS }))
      await mount()
      await sendQuestion('Where?')
      const rows = [...host.querySelectorAll('.askuni-source')] as HTMLButtonElement[]
      for (const row of rows) {
        await act(async () => {
          row.click()
        })
      }
      expect(openCitation.mock.calls.map(([req]) => req)).toEqual(
        CITATIONS.map((c) => ({ kind: c.kind, href: c.href })),
      )
    })

    it('rows are real buttons, so Enter and Space open them from the keyboard', async () => {
      ask.mockResolvedValue(answer('See sources', { citations: CITATIONS }))
      await mount()
      await sendQuestion('Where?')
      const rows = [...host.querySelectorAll('.askuni-source')]
      expect(rows.length).toBe(CITATIONS.length)
      for (const row of rows) {
        expect(row.tagName).toBe('BUTTON')
        expect(row.getAttribute('type')).toBe('button')
        expect((row as HTMLButtonElement).disabled).toBe(false)
      }
    })

    it('a row with an empty href is inert: no button, no action, no bridge call', async () => {
      const bare: AskUniCitation = {
        sourceId: 's7',
        kind: 'other',
        title: 'Project Phoenix',
        quote: 'Kick-off notes',
        href: '',
      }
      ask.mockResolvedValue(answer('See source', { citations: [bare, CITATIONS[1]!] }))
      await mount()
      await sendQuestion('Where?')
      const rows = [...host.querySelectorAll('.askuni-source')]
      expect(rows.map((r) => r.tagName)).toEqual(['DIV', 'BUTTON'])
      const inert = rows[0] as HTMLElement
      expect(inert.textContent).toContain('Project Phoenix')
      expect(inert.textContent).toContain('Kick-off notes')
      expect(inert.textContent).not.toContain(en.askUniOpenBrowser)
      expect(inert.textContent).not.toContain(en.askUniOpenDocument)
      expect(inert.getAttribute('role')).toBeNull()
      expect(inert.getAttribute('tabindex')).toBeNull()
      expect(inert.getAttribute('aria-label') ?? '').not.toContain(en.askUniOpenBrowser)
      await act(async () => {
        inert.click()
      })
      expect(openCitation).not.toHaveBeenCalled()
    })

    it('a refused open shows one inline note and a later success clears it', async () => {
      ask.mockResolvedValue(answer('See sources', { citations: CITATIONS.slice(0, 2) }))
      openCitation.mockResolvedValueOnce({ ok: false, code: 'error' })
      await mount()
      await sendQuestion('Where?')
      const rows = [...host.querySelectorAll('.askuni-source')] as HTMLButtonElement[]
      expect(host.textContent).not.toContain(en.askUniOpenFailed)
      await act(async () => {
        rows[0]!.click()
      })
      await flush()
      const note = host.querySelector('[role="status"].askuni-open-note')
      expect(note?.textContent).toBe(en.askUniOpenFailed)
      expect(host.textContent?.split(en.askUniOpenFailed).length).toBe(2)
      await act(async () => {
        rows[1]!.click()
      })
      await flush()
      expect(host.textContent).not.toContain(en.askUniOpenFailed)
    })

    it('a bridge that rejects also shows the note, never an unhandled error', async () => {
      ask.mockResolvedValue(answer('See sources', { citations: [CITATIONS[1]!] }))
      openCitation.mockRejectedValueOnce(new Error('ipc closed'))
      await mount()
      await sendQuestion('Where?')
      await act(async () => {
        ;(host.querySelector('.askuni-source') as HTMLButtonElement).click()
      })
      await flush()
      expect(host.textContent).toContain(en.askUniOpenFailed)
    })

    it('a signed-out open says the session needs signing in again', async () => {
      ask.mockResolvedValue(answer('See sources', { citations: [CITATIONS[1]!] }))
      openCitation.mockResolvedValueOnce({ ok: false, code: 'signed_out' })
      await mount()
      await sendQuestion('Where?')
      await act(async () => {
        ;(host.querySelector('.askuni-source') as HTMLButtonElement).click()
      })
      await flush()
      expect(host.textContent).toContain(en.askUniOpenFailed)
    })

    it('the open note is localized', async () => {
      ask.mockResolvedValue(answer('Xem nguồn', { citations: [CITATIONS[1]!] }))
      openCitation.mockResolvedValueOnce({ ok: false, code: 'error' })
      await mount('vi')
      await type('Ở đâu?')
      await act(async () => {
        ;(host.querySelector(`button[aria-label="${viStrings.askUniSend}"]`) as HTMLElement).click()
      })
      await flush()
      await act(async () => {
        ;(host.querySelector('.askuni-source') as HTMLButtonElement).click()
      })
      await flush()
      expect(viStrings.askUniOpenFailed).toBeTruthy()
      expect(viStrings.askUniOpenFailed).not.toBe(en.askUniOpenFailed)
      expect(host.textContent).toContain(viStrings.askUniOpenFailed)
    })

    it('renders a citation of kind other as a generic row with the open-in-browser affordance', async () => {
      const other = {
        sourceId: 's9',
        kind: 'other',
        title: 'Policy page',
        quote: 'Remote work rules',
        href: '/o/w/pages/9',
      } as unknown as AskUniCitation
      ask.mockResolvedValue(answer('See source', { citations: [other] }))
      await mount()
      await sendQuestion('Where?')
      const row = host.querySelector('.askuni-source') as HTMLButtonElement
      expect(row.getAttribute('data-kind')).toBe('other')
      expect(row.querySelector('svg')?.childElementCount).toBeGreaterThan(0)
      expect(row.textContent).toContain('Policy page')
      expect(row.textContent).toContain('Remote work rules')
      expect(row.textContent).toContain(en.askUniOpenBrowser)
      expect(row.textContent).not.toContain(en.askUniOpenDocument)
      const name = row.getAttribute('aria-label') ?? ''
      expect(en.askUniKindOther).toBeTruthy()
      expect(name).toContain(en.askUniKindOther)
      expect(name).not.toContain('undefined')
      expect(name).toContain('Policy page')
      await act(async () => {
        row.click()
      })
      expect(openCitation).toHaveBeenCalledWith({ kind: 'other', href: '/o/w/pages/9' })
    })

    it('maps a kind the app does not know to the generic row instead of crashing', async () => {
      const odd = {
        sourceId: 's10',
        kind: 'brand_new_kind',
        title: 'Mystery',
        quote: '',
        href: '/x',
      } as unknown as AskUniCitation
      ask.mockResolvedValue(answer('See source', { citations: [odd] }))
      await mount()
      await sendQuestion('Where?')
      const row = host.querySelector('.askuni-source') as HTMLButtonElement
      expect(en.askUniKindOther).toBeTruthy()
      expect(row.getAttribute('aria-label')).toContain(en.askUniKindOther)
      expect(row.getAttribute('aria-label')).not.toContain('undefined')
      expect(row.querySelector('svg')?.childElementCount).toBeGreaterThan(0)
    })

    it('keeps [Sn] markers as plain text, matched or not, with no link', async () => {
      ask.mockResolvedValue(
        answer('Budget is frozen [S1] and the launch moved [S9].', {
          citations: [CITATIONS[0]!],
        }),
      )
      await mount()
      await sendQuestion('Status?')
      const text = host.querySelector('.askuni-answer-body')?.textContent ?? ''
      expect(text).toContain('[S1]')
      expect(text).toContain('[S9]')
      expect(host.querySelector('.askuni-answer-body a')).toBeNull()
      expect(host.querySelector('.askuni-answer-body button')).toBeNull()
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

    it('offline explains that Ask UNI needs a connection and keeps the question for a retry', async () => {
      ask.mockResolvedValueOnce({ ok: false, code: 'offline' })
      ask.mockResolvedValueOnce(answer('Back online'))
      await mount()
      await sendQuestion('Find the contract')
      expect(host.textContent).toContain(
        'You are offline. Ask UNI needs a connection to search documents.',
      )
      expect(composer().value).toBe('Find the contract')
      expect(composer().disabled).toBe(false)
      await act(async () => {
        sendBtn().click()
      })
      await flush()
      expect(ask).toHaveBeenCalledTimes(2)
      expect(ask.mock.calls[1]![0].question).toBe('Find the contract')
      expect(host.textContent).toContain('Back online')
    })

    it('an error puts the question back into the empty composer', async () => {
      ask.mockResolvedValue({ ok: false, code: 'offline' })
      await mount()
      await sendQuestion('Retry me')
      expect(composer().value).toBe('Retry me')
    })
  })

  describe('context load recovery', () => {
    it('offers Try again when the workspace list fails and reruns the context load', async () => {
      askContext.mockRejectedValueOnce(new Error('ipc broke'))
      await mount()
      expect(host.textContent).toContain(en.askUniErrDefault)
      const retry = [...host.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === settingsEn.setRetry,
      ) as HTMLButtonElement
      expect(retry).toBeDefined()
      await act(async () => {
        retry.click()
      })
      await flush()
      expect(askContext).toHaveBeenCalledTimes(2)
      expect(host.textContent).toContain(WS_A.name)
      expect(composer()).not.toBeNull()
    })

    it('reloads the context when the pane becomes visible again after signed out', async () => {
      askContext.mockResolvedValueOnce(ctx({ signedIn: false, workspaces: [] }))
      await mount('en', { visible: true })
      expect(host.textContent).toContain(en.askUniSignedOut)
      await mount('en', { visible: false })
      expect(askContext).toHaveBeenCalledTimes(1)
      await mount('en', { visible: true })
      expect(askContext).toHaveBeenCalledTimes(2)
      expect(host.textContent).toContain(WS_A.name)
    })

    it('does not reload on becoming visible when the load was fine', async () => {
      await mount('en', { visible: true })
      await mount('en', { visible: false })
      await mount('en', { visible: true })
      expect(askContext).toHaveBeenCalledTimes(1)
    })
  })

  describe('styles and copy', () => {
    it('askuni.css uses logical inline spacing only (RTL locales ar and he)', () => {
      const css = readFileSync(
        new URL('../src/renderer/src/askuni.css', import.meta.url),
        'utf8',
      ).replace(/\/\*[\s\S]*?\*\//g, '')
      expect(css).not.toMatch(/(padding|margin|border)-(left|right)\s*:/)
      expect(css).not.toMatch(/(^|[\s{;])(left|right)\s*:/)
      const fourValue = [...css.matchAll(/(?:padding|margin)\s*:\s*([^;]+);/g)]
        .map((m) => m[1]!.trim().split(/\s+/))
        .filter((v) => v.length === 4)
      expect(fourValue).toEqual([])
    })

    it('vi names the workspace like the rest of the shell vi copy', () => {
      expect(viStrings.askUniWorkspace).toBe('Workspace')
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
            children: h(NewChatPane, {
              practiceId: 'general' as never,
              ensureWorkbench: () => undefined,
            }),
          }),
        )
      })
      await flush()
    }

    const modeBtn = (label: string) =>
      [...host.querySelectorAll('.new-chat-bar button')].find(
        (b) => b.textContent?.trim() === label,
      ) as HTMLButtonElement | undefined

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
      // the pane stays mounted (hidden) so the conversation survives the switch
      const pane = host.querySelector('.askuni-pane') as HTMLElement
      expect(pane.closest('main')?.hasAttribute('hidden')).toBe(true)
      expect(host.querySelector('.new-chat-bar')).not.toBeNull()
    })

    it('keeps the Ask UNI turns, conversation and draft across Assistant and back', async () => {
      await mountPane()
      await act(async () => {
        modeBtn(en.askUniModeAsk)!.click()
      })
      await flush()
      await type('First question')
      await act(async () => {
        sendBtn().click()
      })
      await flush()
      await type('half a draft')
      await act(async () => {
        modeBtn(en.askUniModeChat)!.click()
      })
      await flush()
      await act(async () => {
        modeBtn(en.askUniModeAsk)!.click()
      })
      await flush()
      const pane = host.querySelector('.askuni-pane') as HTMLElement
      expect(pane.closest('main')?.hasAttribute('hidden')).toBe(false)
      expect(pane.textContent).toContain('First question')
      expect(pane.textContent).toContain('Plain answer')
      expect(composer().value).toBe('half a draft')
      expect(askContext).toHaveBeenCalledTimes(1)
      await sendQuestion('Second question')
      expect(ask.mock.calls[1]![0].conversationId).toBe('conv-1')
    })

    it('lets a pending answer land in the kept thread while Ask UNI is hidden', async () => {
      let resolveAsk: (r: AskUniResult) => void = () => undefined
      ask.mockImplementation(
        () =>
          new Promise<AskUniResult>((res) => {
            resolveAsk = res
          }),
      )
      await mountPane()
      await act(async () => {
        modeBtn(en.askUniModeAsk)!.click()
      })
      await flush()
      await sendQuestion('Slow one')
      await act(async () => {
        modeBtn(en.askUniModeChat)!.click()
      })
      await act(async () => {
        resolveAsk(answer('Landed while hidden'))
      })
      await flush()
      await act(async () => {
        modeBtn(en.askUniModeAsk)!.click()
      })
      await flush()
      expect(host.querySelector('.askuni-pane')?.textContent).toContain('Landed while hidden')
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
            children: h(NewChatPane, {
              practiceId: 'general' as never,
              ensureWorkbench: () => undefined,
            }),
          }),
        )
      })
      await flush()
      expect(modeBtn(en.askUniModeAsk)).toBeUndefined()
    })
  })
})
