// UniWork AI notices in the markdown panel (G6-05 slice D): a Retry-After wait is a status line with
// Stop only (no Retry while the run waits); a restarted conversation, a provider boundary and a
// dropped call are plain notes. The loop is replaced by a harness that hands over its events.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { aiUniworkText } from '@genoffice/ui'
import type { AgentStreamNotice } from '@genoffice/agent-core'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider, t } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'
// the stylesheet is only loaded as text so jsdom can compute the rendered style (vitest stubs css imports)
const appStyles = readFileSync(resolve(__dirname, '../src/renderer/styles.css'), 'utf8')

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

import { AiPanel, type MarkdownAiDeps } from '../src/renderer/ai/AiPanel'

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('UniWork AI notices (markdown panel)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy()
    root = null
    container = null
    editor = null
    delete (window as any).projectApi
    vi.unstubAllGlobals()
  })

  function mount(history: 'none' | 'deferred' = 'none') {
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
    vi.stubGlobal(
      'markdownApi',
      new Proxy(stubs, {
        get(target, prop: string) {
          if (!(prop in target)) {
            target[prop] = /^on[A-Z]/.test(prop)
              ? vi.fn(() => () => {})
              : prop === 'getAiSettings'
                ? vi.fn(async () => usableAiSettings())
                : vi.fn(async () => undefined)
          }
          return target[prop]
        },
      }),
    )
    if (history === 'deferred') {
      ;(window as any).projectApi = {
        resolveChat: async () => ({ projectId: 'p', chatId: 'c' }),
        loadChat: () => new Promise(() => {}),
        appendChat: async () => {},
        rebindChat: async () => null,
      }
    }
    editor = new Editor({
      extensions: buildExtensions({
        slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
        slashItems: () => [],
      }),
      content: '<p>Saved document</p>',
    })
    const deps = {
      getEditor: () => editor,
      getFrontmatter: () => '',
      setFrontmatter: () => {},
      getSnapshot: () => ({}),
      restoreSnapshot: () => {},
      onRunDone: () => {},
    } as unknown as MarkdownAiDeps
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (filePath: string | null) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(AiPanel, {
              deps,
              filePath,
              onCollapse: () => {},
              preset: { text: 'rewrite it', nonce: 1 },
            }),
          ),
        ),
      )
    return { render }
  }

  const L = 'en' as const
  const ui = (key: Parameters<typeof aiUniworkText>[1], params?: Record<string, string | number>) =>
    aiUniworkText(L, key, params)
  const notices = () => [...container!.querySelectorAll('.ai-msg-notice')].map((n) => n.textContent)
  const notify = (notice: AgentStreamNotice) => act(async () => harness.events.onNotice(notice))

  /** mount, let the preset start its turn, return once the loop has handed over its events */
  async function started() {
    harness.events = null
    const m = mount()
    m.render('/docs/a.md')
    await flush()
    await flush()
    expect(harness.events, 'the turn started').not.toBeNull()
  }

  it('waiting shows Stop only, no Retry', async () => {
    await started()
    await notify({ kind: 'rate-limit-wait', seconds: 90, attempt: 1 })
    expect(notices()).toEqual([ui('aiErrRateLimited', { seconds: 90 })])
    // the copy itself is pinned in the product languages, not only echoed through aiUniworkText
    expect(notices()).toEqual(['You’re sending too fast. Try again in 90 s.'])
    expect(
      container!.querySelector(`button[aria-label="${t('aiStop')}"]`),
      'Stop stays',
    ).not.toBeNull()
    expect(container!.querySelector('.ai-retry-btn')).toBeNull()
    expect(container!.querySelector(`button[aria-label="${t('aiRegenerateTitle')}"]`)).toBeNull()
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

  it('the notice line is set apart from the reply by its rendered style, with no raw colour (RF2-7)', async () => {
    await started()
    await notify({ kind: 'rate-limit-wait', seconds: 120, attempt: 1 })
    const line = container!.querySelector<HTMLElement>('.ai-msg-notice')
    expect(line, 'the notice line is rendered').not.toBeNull()
    const sheet = document.createElement('style')
    sheet.textContent = appStyles
    document.head.appendChild(sheet)
    try {
      const style = getComputedStyle(line!)
      expect(Number.parseFloat(style.marginTop), 'margin above the notice').toBeGreaterThan(0)
      expect(style.color).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    } finally {
      sheet.remove()
    }
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
    expect(container!.querySelectorAll('[aria-live]')).toHaveLength(1)
    expect(container!.querySelectorAll('[role="status"]:not(.ai-typing)')).toHaveLength(0)
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
    expect(container!.querySelectorAll('[role="status"]')).toHaveLength(0)
    expect(notices()).toEqual([ui('aiConversationRestarted')])
    expect(container!.textContent).not.toContain(t('aiNoReply'))
    // the turn ended quietly: no error line, no Retry, and the question is back in the composer
    expect(container!.querySelector('.ai-msg-error')).toBeNull()
    expect(container!.querySelector('.ai-retry-btn')).toBeNull()
    expect(container!.querySelector('textarea')?.value).toBe('rewrite it')
  })

  it.each([['aiErrQuestionTooLong'], ['aiErrQuestionRejected']] as const)(
    'a refused question (%s) shows its error, offers no Retry or regenerate, and puts the question back in the composer',
    async (key) => {
      await started()
      await act(async () => harness.events.onError(ui(key), key))
      expect(container!.querySelector('.ai-msg-error')?.textContent).toContain(ui(key))
      expect(retryButton()).toBeNull()
      expect(container!.querySelector(`button[aria-label="${t('aiRegenerateTitle')}"]`)).toBeNull()
      expect(container!.querySelector('.ai-msg-undelivered')).toBeNull()
      expect(container!.querySelector('textarea')?.value).toBe('rewrite it')
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
    expect(container!.querySelector(`button[aria-label="${t('aiRegenerateTitle')}"]`)).toBeNull()
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
      ui('aiErrUnsupported', { module: 'Markdown' }),
    ])
  })

  it('when UniWork AI is selected, renders result chip as first words of answer node and announces once in panel live node', async () => {
    await started()
    ;(window as any).markdownApi.getAiSettings = vi.fn(async () => ({
      ...usableAiSettings(),
      provider: 'uniwork',
    }))
    // re-trigger settings sync via focus
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    const chatEl = container!.querySelector('.ai-chat')
    expect(chatEl?.hasAttribute('aria-live')).toBe(false)
    expect(chatEl?.getAttribute('aria-busy')).toBe('true')
    await act(async () => harness.events.onText('Rewritten paragraph.'))
    await act(async () =>
      harness.events.onDone({ text: 'Rewritten paragraph.', cancelled: false, turnLimit: false }),
    )
    expect(chatEl?.hasAttribute('aria-busy')).toBe(false)
    const chipEl = container!.querySelector('.ai-result-chip')
    expect(chipEl).not.toBeNull()
    expect(chipEl?.textContent).toBe(ui('aiResultAnswer'))
    const answerNode = chipEl?.parentElement
    expect(answerNode?.textContent?.startsWith(`${ui('aiResultAnswer')}:`)).toBe(true)
    const live = container!.querySelector('.ai-sr-status')
    expect(live?.textContent).toBe(ui('aiResultAnswer'))
    expect(live?.textContent).not.toContain('Rewritten paragraph.')
  })

  it('Stop before the first token on UniWork AI: no Answer chip and exactly one stopped line (RF2-1)', async () => {
    await started()
    ;(window as any).markdownApi.getAiSettings = vi.fn(async () => ({
      ...usableAiSettings(),
      provider: 'uniwork',
    }))
    // re-trigger settings sync via focus
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    await act(async () => harness.events.onDone({ text: '', cancelled: true, turnLimit: false }))
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

  it('clicking Stop returns keyboard focus to the composer textarea (RF1-12, RF1-23b)', async () => {
    await started()
    const stopBtn = container!.querySelector<HTMLButtonElement>(
      `button[aria-label="${t('aiStop')}"]`,
    )
    expect(stopBtn).not.toBeNull()
    stopBtn!.focus()
    await act(async () => stopBtn!.click())
    expect(document.activeElement).toBe(container!.querySelector('textarea'))
  })
})
