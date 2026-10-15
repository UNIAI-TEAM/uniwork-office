// UniWork AI result chip wiring in the docs panel (G6-05u visual r1 F1, F2, F3, F6, F11): an error turn offers
// its labelled action, the announcement is the line on screen, dropped calls read Chưa hỗ trợ, and the
// chip opens the answer paragraph. Same harness as uniwork-ai-notice.test.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { AI_RUN_IDLE_GRACE_MS } from '@genoffice/agent-core'
import { aiUniworkText } from '@genoffice/ui'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { getLang, LocaleProvider, setModuleLang, t } from '../src/renderer/i18n/locale'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'

const settings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: 'k', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('UniWork AI chip wiring (docs panel)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null
  let listener: ((chunk: any) => void) | undefined
  let requestId = ''
  let reports: Array<{ state: string; runId?: string }>

  const emit = (chunk: Record<string, unknown>) =>
    act(async () => {
      listener?.({ requestId, ...chunk })
    })
  /** the tracker holds the idle back for its grace (a tool step is not a new turn) */
  const pastGrace = () => new Promise((resolve) => setTimeout(resolve, AI_RUN_IDLE_GRACE_MS + 100))
  const ui = (key: Parameters<typeof aiUniworkText>[1], params?: Record<string, string | number>) =>
    aiUniworkText(getLang(), key, params)

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })

  beforeEach(async () => {
    // product copy is vi/en; the module default (zh) is not what users read here
    setModuleLang('vi')
    reports = []
    listener = undefined
    ;(window as any).uniworkAiRun = { reportAiRun: (r: any) => reports.push(r) }
    ;(window as any).desktop = {
      onAiStream: (l: (chunk: unknown) => void) => {
        listener = l
        return () => {
          listener = undefined
        }
      },
      aiStream: async (request: { requestId: string }) => {
        requestId = request.requestId
      },
      aiStreamCancel: async () => {},
      onLanguageChanged: () => () => {},
    }
    editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'docParagraph', attrs: { docxIndex: 0 }, content: [{ type: 'text', text: 'x' }] },
        ],
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root!.render(
        createElement(LocaleProvider, {
          initial: 'vi',
          children: createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings,
            open: true,
            filePath: '/docs/a.docx',
            preset: { text: 'summarize it', nonce: 1, autoRun: true },
          }),
        }),
      ),
    )
    // the run starts once the panel has flushed its first effects
    for (let i = 0; i < 6 && !requestId; i++) await flush()
    expect(requestId, 'the turn started').not.toBe('')
  })

  afterEach(async () => {
    // every test ends its turn; the shared tracker must be idle before the next one starts
    await pastGrace()
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy()
    root = null
    container = null
    editor = null
    delete (window as any).desktop
    delete (window as any).uniworkAiRun
    setModuleLang('zh')
  })

  const notices = () => [...container!.querySelectorAll('.ai-msg-notice')].map((n) => n.textContent)
  const stopButton = () =>
    container!.querySelector<HTMLButtonElement>(`button[aria-label="${t('aiStop')}"]`)

  const root_ = () => container!
  const MODULE = 'Docs'
  const uniworkTurn = async (): Promise<void> => {
    act(() =>
      root!.render(
        createElement(LocaleProvider, {
          initial: 'vi',
          children: createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings: { ...settings, provider: 'uniwork' },
            open: true,
            filePath: '/docs/a.docx',
            preset: { text: 'summarize it', nonce: 1, autoRun: true },
          }),
        }),
      ),
    )
  }
  const failWith = async (code: string, _errKey: string): Promise<void> => {
    await emit({ type: 'error', uniworkCode: code, error: 'ignored' })
    await pastGrace()
  }
  const failRaw = async (text: string): Promise<void> => {
    await emit({ type: 'error', error: text })
    await pastGrace()
  }
  const visibleErrorText = () => root_().querySelector('.ai-msg-error')?.textContent
  const dropCalls = (calls: unknown[]) =>
    emit({ type: 'notice', notice: { kind: 'dropped-tool-calls', calls } })
  const finish = async (): Promise<void> => {
    await emit({ type: 'done' })
    await pastGrace()
  }
  const streamAnswer = async (text: string): Promise<void> => {
    await emit({ type: 'delta', text })
    await finish()
  }
  const ackIfAsked = async (): Promise<void> => {
    const ackBtn = container!.querySelector<HTMLButtonElement>('[role="region"] button')
    if (ackBtn) await act(async () => ackBtn.click())
    await flush()
  }

  it.each([
    ['credits_exhausted', 'aiErrCredits', 'aiRunChooseOther'],
    ['session_expired', 'aiErrSession', 'acctSignInAgain'],
    ['cloud_unavailable', 'aiErrUnavailable', 'aiRunRetry'],
    ['run_limit_reached', 'aiErrRunLimit', 'aiRunAskAgain'],
  ] as const)(
    'F1/F2: a %s error turn shows its labelled action and announces the line it shows',
    async (code, errKey, actionKey) => {
      await uniworkTurn()
      await failWith(code, errKey)
      expect(root_().querySelector('.ai-result-chip')?.textContent).toBe(ui('aiResultError'))
      const buttons = [...root_().querySelectorAll<HTMLButtonElement>('.ai-error-action button')]
      expect(buttons.map((b) => b.textContent)).toEqual([ui(actionKey)])
      expect(root_().querySelector('.ai-sr-status')?.textContent).toBe(
        `${ui('aiResultError')}. ${ui(errKey)}`,
      )
      expect(visibleErrorText()).toBe(ui(errKey))
    },
  )

  it('F1: a generic error offers no action and a rate-limit wait offers no Retry', async () => {
    await uniworkTurn()
    await failRaw('weird provider text')
    expect(root_().querySelector('.ai-error-action')).toBeNull()
  })

  it('F3: a dropped view-only call reads Chưa hỗ trợ with its reason, a dropped not_allowlisted call names the module', async () => {
    await uniworkTurn()
    await dropCalls([{ index: 0, name: 'edit', reason: 'view_only' }])
    await finish()
    expect(root_().querySelector('.ai-result-chip')?.getAttribute('data-chip')).toBe('unsupported')
    expect(root_().querySelector('.ai-result-chip')?.textContent).toBe(ui('aiResultUnsupported'))
    expect(root_().querySelector('.ai-sr-status')?.textContent).toBe(
      `${ui('aiResultUnsupported')}. ${ui('aiErrViewOnlyEdit')}`,
    )
  })

  it('F3: not_allowlisted announces aiErrUnsupported with the module', async () => {
    await uniworkTurn()
    await dropCalls([{ index: 0, name: 'x', reason: 'not_allowlisted' }])
    await finish()
    expect(root_().querySelector('.ai-result-chip')?.getAttribute('data-chip')).toBe('unsupported')
    expect(root_().querySelector('.ai-sr-status')?.textContent).toBe(
      `${ui('aiResultUnsupported')}. ${ui('aiErrUnsupported', { module: MODULE })}`,
    )
  })

  it('F6: the chip is the first word of the answer paragraph, in the same node as the text', async () => {
    await uniworkTurn()
    await streamAnswer('Câu trả lời ngắn.')
    const chip = root_().querySelector('.ai-result-chip')!
    const paragraph = chip.parentElement!
    expect(paragraph.tagName).toBe('P')
    expect(paragraph.closest('.ai-msg-answer')).not.toBeNull()
    expect(paragraph.textContent!.startsWith(ui('aiResultAnswer'))).toBe(true)
    expect(paragraph.textContent).toContain('Câu trả lời ngắn.')
  })

  it('F1: Thử lại sends the turn again, Chọn nhà cung cấp khác opens the model settings, Hỏi tiếp returns to the composer', async () => {
    const openSettings = vi.fn(async () => {})
    ;(window as any).desktop.openAiModelSettings = openSettings
    await uniworkTurn()
    await ackIfAsked()
    await failWith('cloud_unavailable', 'aiErrUnavailable')
    const before = requestId
    await act(async () =>
      root_().querySelector<HTMLButtonElement>('.ai-error-action button')!.click(),
    )
    for (let i = 0; i < 6 && requestId === before; i++) await flush()
    expect(requestId, 'the retried turn started').not.toBe(before)
    await finish()

    await failWith('credits_exhausted', 'aiErrCredits')
    await act(async () =>
      root_().querySelector<HTMLButtonElement>('.ai-error-action button')!.click(),
    )
    expect(openSettings).toHaveBeenCalledTimes(1)

    await failWith('run_limit_reached', 'aiErrRunLimit')
    ;(document.activeElement as HTMLElement | null)?.blur()
    await act(async () =>
      root_().querySelector<HTMLButtonElement>('.ai-error-action button')!.click(),
    )
    expect(document.activeElement).toBe(root_().querySelector('textarea'))
  })
})
