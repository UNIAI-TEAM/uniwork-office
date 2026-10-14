// UniWork AI notices in the docs panel (G6-05 slice D): the real loop + IPC transport + panel,
// a fake main process behind window.desktop. A Retry-After wait is a status line with Stop only
// (no Retry while the run is waiting), a restarted conversation / provider boundary / dropped
// call are plain notes, and every ending path reports exactly one aiRun idle.
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
  const stopButton = () => container!.querySelector(`button[aria-label="${t('aiStop')}"]`)

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
    const live = container!.querySelector('.ai-msg-assistant [aria-live="polite"]')
    expect(live, 'live region before any notice').not.toBeNull()
    expect(live!.textContent).toBe('')
    await emit({ type: 'notice', notice: { kind: 'rate-limit-wait', seconds: 30, attempt: 1 } })
    // the same node (not a new one mounted with its text) now holds the note, and nothing else announces
    expect(container!.querySelector('.ai-msg-assistant [aria-live="polite"]')).toBe(live)
    expect(live!.textContent).toBe(ui('aiErrRateLimited', { seconds: 30 }))
    expect(container!.querySelectorAll('.ai-msg-notice [role="status"]')).toHaveLength(0)
    expect(live!.querySelectorAll('.ai-msg-notice')).toHaveLength(1)
    // a restart note joins the wait line in the same region
    await emit({ type: 'notice', notice: { kind: 'conversation-restarted' } })
    expect(live!.textContent).toContain(ui('aiConversationRestarted'))
    await emit({ type: 'done' })
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
})
