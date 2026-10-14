// UniWork AI notices in the pdf panel (G6-05 slice D): a Retry-After wait is a status line with
// Stop only (no Retry while the run waits); a restarted conversation, a provider boundary and a
// dropped call are plain notes. The loop is replaced by a harness that hands over its events.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { aiUniworkText } from '@genoffice/ui'
import type { AgentStreamNotice } from '@genoffice/agent-core'
import { createRoot, type Root } from 'react-dom/client'

// the loop is replaced by a harness that hands over its events and never finishes on its own
const harness = vi.hoisted(() => ({ events: null as any, loop: null as any }))
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    constructor(readonly opts: any) {
      harness.events = opts.events
      harness.loop = this
    }
    async run(): Promise<void> {
      this.busy = true
    }
    cancel(): void {}
    reset(): void {}
    restore(): void {}
  }
  return { ...real, AgentLoop: FakeLoop }
})

import { AiPanel } from '../src/renderer/ai/AiPanel'
import { LocaleProvider, t } from '../src/renderer/i18n/locale'

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('UniWork AI notices (pdf panel)', () => {
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
    delete (window as any).projectApi
    delete (window as any).pdfApi
  })

  const api = new Proxy(
    { fileName: () => 'doc.pdf', readOnly: () => false, selection: () => null },
    { get: (t, p: string) => (p in t ? (t as never)[p] : () => null) },
  )

  function mount(history: 'none' | 'deferred' = 'none') {
    ;(window as any).pdfApi = {
      getAiSettings: async () => ({}),
      setAiPanelPrefs: () => {},
      gskStatus: async () => ({ loggedIn: false }),
      onLanguageChanged: () => () => {},
    }
    if (history === 'deferred') {
      ;(window as any).projectApi = {
        resolveChat: async () => ({ projectId: 'p', chatId: 'c' }),
        loadChat: () => new Promise(() => {}),
        appendChat: async () => {},
        rebindChat: async () => null,
      }
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (filePath: string | undefined, nonce = 1) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'vi' },
            createElement(AiPanel, {
              api: api as never,
              filePath,
              onCollapse: () => {},
              open: true,
              preset: { text: 'which pages?', nonce },
            }),
          ),
        ),
      )
    return { render }
  }

  const L = 'vi' as const
  const ui = (key: Parameters<typeof aiUniworkText>[1], params?: Record<string, string | number>) =>
    aiUniworkText(L, key, params)
  const notices = () => [...container!.querySelectorAll('.ai-msg-notice')].map((n) => n.textContent)
  const notify = (notice: AgentStreamNotice) => act(async () => harness.events.onNotice(notice))

  /** mount, let the preset start its turn, return once the loop has handed over its events */
  async function started() {
    harness.events = null
    const m = mount()
    m.render('/docs/a.pdf')
    await flush()
    await flush()
    expect(harness.events, 'the turn started').not.toBeNull()
  }

  it('waiting shows Stop only, no Retry', async () => {
    await started()
    await notify({ kind: 'rate-limit-wait', seconds: 90, attempt: 1 })
    expect(notices()).toEqual([ui('aiErrRateLimited', { seconds: 90 })])
    // the copy itself is pinned in the product languages, not only echoed through aiUniworkText
    expect(notices()).toEqual(['Bạn đang gửi quá nhanh. Thử lại sau 90 giây.'])
    expect(
      container!.querySelector(`button[aria-label="${t('aiStop')}"]`),
      'Stop stays',
    ).not.toBeNull()
    expect(container!.querySelector('.ai-retry-btn')).toBeNull()
    expect(container!.querySelector(`button[aria-label="${t('aiRetry')}"]`)).toBeNull()
    expect(container!.querySelector('.ai-msg-error')).toBeNull()
    // the resend streams text: the status line goes
    await act(async () => harness.events.onText('the answer'))
    expect(notices()).toEqual([])
    expect(container!.textContent).toContain('the answer')
  })

  const retryButton = () => container!.querySelector<HTMLButtonElement>('.ai-retry-btn')

  it('a wait that gives up ends as an error and Retry IS offered', async () => {
    await started()
    await notify({ kind: 'rate-limit-wait', seconds: 5, attempt: 1 })
    // the positive control of the wait test: no Retry while waiting ...
    expect(retryButton()).toBeNull()
    await act(async () => harness.events.onError('too fast'))
    expect(notices()).toEqual([])
    // ... and the same control is there once the wait gave up, so the null above can fail
    expect(retryButton(), 'Retry after the give-up').not.toBeNull()
  })

  it('a wait after an earlier failed turn still shows Stop only', async () => {
    await started()
    await act(async () => harness.events.onError('first failed'))
    // the real loop is idle after a failure; the fake never finishes on its own
    harness.loop.busy = false
    const retry = retryButton()
    expect(retry, 'Retry after the first failure').not.toBeNull()
    await act(async () => retry!.click())
    await flush()
    await notify({ kind: 'rate-limit-wait', seconds: 30, attempt: 1 })
    expect(notices()).toEqual([ui('aiErrRateLimited', { seconds: 30 })])
    expect(
      container!.querySelector(`button[aria-label="${t('aiStop')}"]`),
      'Stop stays',
    ).not.toBeNull()
    expect(retryButton()).toBeNull()
  })

  it('the notice line has its own style rule (set apart from the reply, no raw colours)', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/styles.css'),
      'utf8',
    )
    const rule = /\n\.ai-msg-notice \{([^}]*)\}/.exec(css)
    expect(rule, '.ai-msg-notice rule').not.toBeNull()
    expect(rule![1]).toMatch(/margin-top:/)
    expect(rule![1]).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })

  it('one persistent aria-live region is mounted before the notice, and the note lands inside it', async () => {
    await started()
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
    await notify({ kind: 'rate-limit-wait', seconds: 30, attempt: 1 })
    // the same node (not a new one mounted with its text) now holds the note, and nothing else in .ai-chat announces
    expect(container!.querySelector('.ai-sr-status')).toBe(live)
    expect(live!.textContent).toBe(ui('aiErrRateLimited', { seconds: 30 }))
    expect(container!.querySelectorAll('.ai-msg-notice [role="status"]')).toHaveLength(0)
    expect(container!.querySelectorAll('.ai-msg-notice')).toHaveLength(1)
    // a restart note joins the wait line in the same region
    await notify({ kind: 'conversation-restarted' })
    expect(live!.textContent).toContain(ui('aiConversationRestarted'))
  })

  it('a restarted conversation keeps its note and no empty-reply line', async () => {
    await started()
    await notify({ kind: 'conversation-restarted' })
    await act(async () => harness.events.onDone({ text: '', cancelled: false, turnLimit: false }))
    expect(notices()).toEqual([ui('aiConversationRestarted')])
    expect(container!.textContent).not.toContain(t('aiNoReply'))
    // the turn ended quietly: no error line, no Retry, and the question is back in the composer
    expect(container!.querySelector('.ai-msg-error')).toBeNull()
    expect(container!.querySelector('.ai-retry-btn')).toBeNull()
    expect(container!.querySelector('textarea')?.value).toBe('which pages?')
  })

  it.each([['aiErrQuestionTooLong'], ['aiErrQuestionRejected']] as const)(
    'a refused question (%s) shows its error, offers no Retry or regenerate, and puts the question back in the composer',
    async (key) => {
      await started()
      await act(async () => harness.events.onError(ui(key)))
      expect(container!.querySelector('.ai-msg-error')?.textContent).toContain(ui(key))
      expect(retryButton()).toBeNull()
      expect(container!.querySelector(`button[aria-label="${t('aiRegenerateTitle')}"]`)).toBeNull()
      expect(container!.querySelector('.ai-msg-undelivered')).toBeNull()
      expect(container!.querySelector('textarea')?.value).toBe('which pages?')
    },
  )

  it('another failure still offers Retry and leaves the composer alone (control)', async () => {
    await started()
    await act(async () => harness.events.onError('server fell over'))
    expect(retryButton()).not.toBeNull()
    expect(container!.querySelector('textarea')?.value).toBe('')
  })

  it('UniWork AI off: one note, no error line, no Retry or regenerate, no empty-reply line', async () => {
    await started()
    await notify({ kind: 'uniwork-off' })
    await act(async () => harness.events.onDone({ text: '', cancelled: false, turnLimit: false }))
    expect(notices()).toEqual([ui('aiUniworkOff')])
    expect(container!.querySelector('.ai-msg-error')).toBeNull()
    expect(container!.querySelector('.ai-retry-btn')).toBeNull()
    expect(container!.textContent).not.toContain(t('aiNoReply'))
  })

  it('a provider boundary and dropped calls become notes', async () => {
    await started()
    await notify({ kind: 'conversation-boundary', provider: 'uniwork' })
    await notify({
      kind: 'dropped-tool-calls',
      calls: [
        { index: 0, name: 'edit', reason: 'view_only' },
        { index: 1, name: 'x', reason: 'not_allowlisted' },
      ],
    })
    expect(notices()).toEqual([
      ui('aiConversationBoundary', { provider: ui('aiUniworkProvider') }),
      ui('aiErrViewOnlyEdit'),
      ui('aiErrUnsupported', { module: 'PDF' }),
    ])
  })

  it('when UniWork AI is selected, renders result chip as first words of answer node and announces once in panel live node', async () => {
    await started()
    ;(window as any).pdfApi.getAiSettings = async () => ({ provider: 'uniwork', providers: {} })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    const chatEl = container!.querySelector('.ai-chat')
    expect(chatEl?.hasAttribute('aria-live')).toBe(false)
    expect(chatEl?.getAttribute('aria-busy')).toBe('true')
    await act(async () => harness.events.onText('Trang 1 đến 3.'))
    await act(async () =>
      harness.events.onDone({ text: 'Trang 1 đến 3.', cancelled: false, turnLimit: false }),
    )
    expect(chatEl?.hasAttribute('aria-busy')).toBe(false)
    const chipEl = container!.querySelector('.ai-result-chip')
    expect(chipEl).not.toBeNull()
    expect(chipEl?.textContent).toBe(ui('aiResultAnswer'))
    const answerNode = chipEl?.parentElement
    expect(answerNode?.textContent?.startsWith(`${ui('aiResultAnswer')}:`)).toBe(true)
    const live = container!.querySelector('.ai-sr-status')
    expect(live?.textContent).toContain(ui('aiResultAnswer'))
    expect(live?.textContent).toContain('Trang 1 đến 3.')
  })
})
