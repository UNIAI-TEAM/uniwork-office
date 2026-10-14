// UniWork AI notices in the markdown panel (G6-05 slice D): a Retry-After wait is a status line with
// Stop only (no Retry while the run waits); a restarted conversation, a provider boundary and a
// dropped call are plain notes. The loop is replaced by a harness that hands over its events.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { aiUniworkText } from '@genoffice/ui'
import type { AgentStreamNotice } from '@genoffice/agent-core'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider, t } from '../src/renderer/i18n/locale'
import { strings } from '../src/renderer/i18n/strings'
import { usableAiSettings } from './helpers/ai-settings'

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
  let resolveHistory: (msgs: unknown[]) => void = () => {}

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
        loadChat: () => new Promise((resolve) => (resolveHistory = resolve)),
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

  it('a restarted conversation keeps its note and no empty-reply line', async () => {
    await started()
    await notify({ kind: 'conversation-restarted' })
    await act(async () => harness.events.onDone({ text: '', cancelled: false, turnLimit: false }))
    expect(notices()).toEqual([ui('aiConversationRestarted')])
    expect(container!.textContent).not.toContain(t('aiNoReply'))
    // the turn ended quietly: no error line, no Retry, and the question is back in the composer
    expect(container!.querySelector('.ai-msg-error')).toBeNull()
    expect(container!.querySelector('.ai-retry-btn')).toBeNull()
    expect(container!.querySelector('textarea')?.value).toBe('rewrite it')
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
})
