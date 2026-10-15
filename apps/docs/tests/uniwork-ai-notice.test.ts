// UniWork AI notices in the docs panel (G6-05 slice D): the real loop + IPC transport + panel,
// a fake main process behind window.desktop. A Retry-After wait is a status line with Stop only
// (no Retry while the run is waiting), a restarted conversation / provider boundary / dropped
// call are plain notes, and every ending path reports exactly one aiRun idle.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

describe('UniWork AI notices (docs panel)', () => {
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

  it('waiting shows Stop only, no Retry', async () => {
    await emit({ type: 'notice', notice: { kind: 'rate-limit-wait', seconds: 120, attempt: 1 } })
    expect(notices()).toEqual([ui('aiErrRateLimited', { seconds: 120 })])
    // the copy itself is pinned in the product languages, not only echoed through aiUniworkText
    expect(notices()).toEqual(['Bạn đang gửi quá nhanh. Thử lại sau 120 giây.'])
    expect(stopButton(), 'Stop stays available').not.toBeNull()
    // no retry / regenerate / error line while the run waits
    expect(container!.querySelector('.ai-retry-btn')).toBeNull()
    expect(container!.querySelector(`button[aria-label="${t('aiRegenerateTitle')}"]`)).toBeNull()
    expect(container!.querySelector('.ai-msg-error')).toBeNull()
    expect(reports.map((r) => r.state)).toEqual(['running'])

    // the adapter resends after the wait: the status line goes, the answer streams in
    await emit({ type: 'reset' })
    await emit({ type: 'delta', text: 'the answer' })
    expect(notices()).toEqual([])
    expect(container!.textContent).toContain('the answer')
    await emit({ type: 'done' })
    expect(stopButton()).toBeNull()
    await pastGrace()
    expect(reports.map((r) => r.state)).toEqual(['running', 'idle'])
  })

  const regenerateButton = () =>
    container!.querySelector<HTMLButtonElement>(`button[aria-label="${t('aiRegenerateTitle')}"]`)

  it('a wait that gives up ends as an error with one idle, and Retry IS offered', async () => {
    await emit({ type: 'notice', notice: { kind: 'rate-limit-wait', seconds: 5, attempt: 1 } })
    // the positive control of the wait test: while waiting there is no regenerate control ...
    expect(regenerateButton()).toBeNull()
    await emit({ type: 'error', error: 'too fast', uniworkCode: 'ai_rate_limited' })
    expect(notices()).toEqual([])
    expect(container!.querySelector('.ai-msg-error')).not.toBeNull()
    // ... and once it gave up the same control is there, so the null above can fail
    expect(regenerateButton(), 'Retry after the give-up').not.toBeNull()
    await pastGrace()
    expect(reports.map((r) => r.state)).toEqual(['running', 'idle'])
  })

  it('a wait after an earlier failed turn still shows Stop only (the old error keeps no Retry live)', async () => {
    await emit({ type: 'error', error: 'first failed', uniworkCode: 'ai_provider_error' })
    expect(container!.querySelector('.ai-msg-error')).not.toBeNull()
    await pastGrace()
    const retry = regenerateButton()
    expect(retry, 'Retry after the first failure').not.toBeNull()
    // Retry starts the next turn; its 429 wait is a status line with Stop only
    requestId = ''
    await act(async () => retry!.click())
    for (let i = 0; i < 6 && !requestId; i++) await flush()
    expect(requestId, 'the retried turn started').not.toBe('')
    await emit({ type: 'notice', notice: { kind: 'rate-limit-wait', seconds: 30, attempt: 1 } })
    expect(notices()).toEqual([ui('aiErrRateLimited', { seconds: 30 })])
    expect(stopButton(), 'Stop stays').not.toBeNull()
    expect(regenerateButton()).toBeNull()
    expect(container!.querySelector('.ai-retry-btn')).toBeNull()
    await emit({ type: 'done' })
    await pastGrace()
  })

  it('one persistent aria-live region is mounted before the notice, and the note lands inside it', async () => {
    const chatEl = container!.querySelector('.ai-chat')
    expect(chatEl?.hasAttribute('aria-live')).toBe(false)
    expect(chatEl?.getAttribute('aria-busy')).toBe('true')
    expect(container!.querySelector('.ai-msg-assistant [aria-live]')).toBeNull()
    const live = container!.querySelector('.ai-sr-status')
    expect(live, 'live region before any notice').not.toBeNull()
    expect(live!.getAttribute('aria-live')).toBe('polite')
    expect(live!.textContent).toBe('')
    // a plain aria-live container: role=status would collide with the app's own status nodes
    expect(live!.hasAttribute('role')).toBe(false)
    await emit({ type: 'notice', notice: { kind: 'rate-limit-wait', seconds: 30, attempt: 1 } })
    // the same node (not a new one mounted with its text) now holds the note, and nothing else in .ai-chat announces
    expect(container!.querySelector('.ai-sr-status')).toBe(live)
    expect(container!.querySelectorAll('[aria-live]')).toHaveLength(1)
    expect(container!.querySelectorAll('[role="status"]:not(.ai-typing)')).toHaveLength(0)
    expect(live!.textContent).toBe(ui('aiErrRateLimited', { seconds: 30 }))
    expect(container!.querySelectorAll('.ai-msg-notice [role="status"]')).toHaveLength(0)
    expect(container!.querySelectorAll('.ai-msg-notice')).toHaveLength(1)
    // a restart note joins the wait line in the same region
    await emit({ type: 'notice', notice: { kind: 'conversation-restarted' } })
    expect(live!.textContent).toContain(ui('aiConversationRestarted'))
    await emit({ type: 'done' })
    expect(chatEl?.hasAttribute('aria-busy')).toBe(false)
    expect(container!.querySelectorAll('[role="status"]')).toHaveLength(0)
  })

  it('a restarted conversation shows its note and not an empty-reply line', async () => {
    await emit({ type: 'notice', notice: { kind: 'conversation-restarted' } })
    await emit({ type: 'done' })
    expect(notices()).toEqual([ui('aiConversationRestarted')])
    expect(container!.textContent).not.toContain(t('aiNoReply'))
    await pastGrace()
    expect(reports.map((r) => r.state)).toEqual(['running', 'idle'])
    // the turn ended quietly: no error line, no Retry, and the question is back in the composer
    expect(container!.querySelector('.ai-msg-error')).toBeNull()
    expect(container!.querySelector('.ai-retry-btn')).toBeNull()
    expect(container!.querySelector('textarea')?.value).toBe('summarize it')
  })

  it.each([
    ['question_too_long', 'aiErrQuestionTooLong'],
    ['question_rejected', 'aiErrQuestionRejected'],
  ] as const)(
    'a %s refusal shows its error, offers no Retry or regenerate, and puts the question back in the composer',
    async (uniworkCode, key) => {
      await emit({ type: 'error', uniworkCode, error: 'ignored' })
      expect(container!.querySelector('.ai-msg-error')?.textContent).toContain(ui(key))
      expect(container!.querySelector('.ai-retry-btn')).toBeNull()
      expect(container!.querySelector(`button[aria-label="${t('aiRegenerateTitle')}"]`)).toBeNull()
      expect(container!.querySelector('textarea')?.value).toBe('summarize it')
      await pastGrace()
      expect(reports.map((r) => r.state)).toEqual(['running', 'idle'])
    },
  )

  it('a refused question does not overwrite a newer draft typed while the turn ran', async () => {
    const box = container!.querySelector('textarea') as HTMLTextAreaElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(box, 'a newer draft')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(box.value).toBe('a newer draft')
    await emit({ type: 'error', uniworkCode: 'question_rejected', error: 'ignored' })
    expect(container!.querySelector('.ai-msg-error')).not.toBeNull()
    expect(container!.querySelector('textarea')?.value).toBe('a newer draft')
    await pastGrace()
  })

  it('another failure still offers regenerate and leaves the composer alone (control)', async () => {
    await emit({ type: 'error', uniworkCode: 'unavailable', error: 'ignored' })
    expect(container!.querySelector('.ai-msg-error')).not.toBeNull()
    expect(
      container!.querySelector(`button[aria-label="${t('aiRegenerateTitle')}"]`),
    ).not.toBeNull()
    expect(container!.querySelector('textarea')?.value).toBe('')
  })

  it('the images-not-sent note shows above the answer and the turn is no error', async () => {
    await emit({ type: 'notice', notice: { kind: 'images-not-sent' } })
    await emit({ type: 'delta', text: 'the answer' })
    await emit({ type: 'done' })
    expect(notices()).toEqual([ui('aiUniworkImagesNotSent')])
    expect(notices()).toEqual(['UniWork AI không nhận ảnh; chỉ phần chữ đã được gửi.'])
    const text = container!.textContent!
    expect(text.indexOf(ui('aiUniworkImagesNotSent'))).toBeGreaterThanOrEqual(0)
    expect(text.indexOf(ui('aiUniworkImagesNotSent'))).toBeLessThan(text.indexOf('the answer'))
    expect(container!.querySelector('.ai-msg-error')).toBeNull()
    expect(text).not.toContain(t('aiNoReply'))
  })

  it('UniWork AI off: one note, no error line, no Retry or regenerate, no empty-reply line', async () => {
    await emit({ type: 'notice', notice: { kind: 'uniwork-off' } })
    await emit({ type: 'done' })
    expect(notices()).toEqual([ui('aiUniworkOff')])
    expect(container!.querySelector('.ai-msg-error')).toBeNull()
    expect(container!.querySelector('.ai-retry-btn')).toBeNull()
    expect(container!.querySelector(`button[aria-label="${t('aiRegenerateTitle')}"]`)).toBeNull()
    expect(container!.textContent).not.toContain(t('aiNoReply'))
    await pastGrace()
    expect(reports.map((r) => r.state)).toEqual(['running', 'idle'])
  })

  it('a provider boundary and dropped calls become notes above the answer', async () => {
    await emit({
      type: 'notice',
      notice: { kind: 'conversation-boundary', provider: 'UniWork AI' },
    })
    await emit({
      type: 'notice',
      notice: {
        kind: 'dropped-tool-calls',
        calls: [
          { index: 0, name: 'edit', reason: 'view_only' },
          { index: 1, name: 'x', reason: 'not_allowlisted' },
        ],
      },
    })
    await emit({ type: 'delta', text: 'partial' })
    await emit({ type: 'done' })
    expect(notices()).toEqual([
      ui('aiConversationBoundary', { provider: 'UniWork AI' }),
      ui('aiErrViewOnlyEdit'),
      ui('aiErrUnsupported', { module: 'Docs' }),
    ])
    expect(container!.textContent).toContain('partial')
  })

  it('when UniWork AI is selected, renders result chip as first words of answer node and announces once in panel live region', async () => {
    const uniworkSettings: AiSettings = {
      ...settings,
      provider: 'uniwork',
    }
    act(() =>
      root!.render(
        createElement(LocaleProvider, {
          initial: 'vi',
          children: createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings: uniworkSettings,
            open: true,
            filePath: '/docs/a.docx',
            preset: { text: 'summarize it', nonce: 1, autoRun: true },
          }),
        }),
      ),
    )
    const chatEl = container!.querySelector('.ai-chat')
    expect(chatEl?.hasAttribute('aria-live')).toBe(false)
    expect(chatEl?.getAttribute('aria-busy')).toBe('true')
    await emit({ type: 'delta', text: 'Tóm tắt 3 ý chính.' })
    await emit({ type: 'done' })
    expect(chatEl?.hasAttribute('aria-busy')).toBe(false)
    const chipEl = container!.querySelector('.ai-result-chip')
    expect(chipEl).not.toBeNull()
    expect(chipEl?.textContent).toBe(ui('aiResultAnswer'))
    const answerNode = chipEl?.parentElement
    expect(answerNode?.textContent?.startsWith(`${ui('aiResultAnswer')}:`)).toBe(true)
    expect(answerNode?.textContent).toContain('Tóm tắt 3 ý chính.')
    const live = container!.querySelector('.ai-sr-status')
    expect(live?.textContent).toBe(ui('aiResultAnswer'))
    expect(live?.textContent).not.toContain('Tóm tắt 3 ý chính.')
  })

  it('clicking Stop returns keyboard focus to the composer textarea (RF1-12, RF1-23b)', async () => {
    const stop = stopButton()
    expect(stop).not.toBeNull()
    stop!.focus()
    await act(async () => stop!.click())
    expect(document.activeElement).toBe(container!.querySelector('textarea'))
    await pastGrace()
  })

  it('Stop before the first token on UniWork AI: no Answer chip and exactly one stopped line (RF2-1)', async () => {
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
    // the main process ends a cancelled stream with a done chunk
    ;(window as any).desktop.aiStreamCancel = async () => {
      listener?.({ requestId, type: 'done' })
    }
    const stop = stopButton()
    expect(stop).not.toBeNull()
    await act(async () => stop!.click())
    await flush()
    await pastGrace()
    expect(container!.querySelector('.ai-result-chip')).toBeNull()
    const stoppedLines = [...container!.querySelectorAll('.ai-msg-assistant *')].filter(
      (el) => el.children.length === 0 && el.textContent === ui('aiRunStopped'),
    )
    expect(stoppedLines).toHaveLength(1)
    expect(container!.querySelector('.ai-msg-answer')?.textContent ?? '').not.toContain(
      t('aiStopped'),
    )
    expect(container!.querySelector('.ai-sr-status')?.textContent).toBe(ui('aiRunStopped'))
  })
})
