// UniWork AI notices in the html panel (G6-05 slice D): a Retry-After wait is a status line with
// Stop only (no Retry while the run waits); a restarted conversation, a provider boundary and a
// dropped call are plain notes. The loop is replaced by a harness that hands over its events.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { aiUniworkText } from '@genoffice/ui'
import type { AgentStreamNotice } from '@genoffice/agent-core'
import { createRoot, type Root } from 'react-dom/client'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { usableAiSettings } from './helpers/ai-settings'

// the loop is replaced by a harness that hands over its events and never finishes on its own
const harness = vi.hoisted(() => ({ events: null as any }))
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    constructor(readonly opts: any) {
      harness.events = opts.events
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

import { AiPanel, type HtmlAiDeps } from '../src/renderer/ai/AiPanel'
import { LocaleProvider, t } from '../src/renderer/i18n/locale'

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('UniWork AI notices (html panel)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
    vi.stubGlobal(
      'htmlApi',
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
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    vi.unstubAllGlobals()
  })

  const text = '<!doctype html>\n<html><body><h1>Quarterly</h1></body></html>'
  const deps = {
    access: {
      getText: () => text,
      getVersion: () => 1,
      getMap: () => buildParseMap(text, 1, null),
      getLastManualVersion: () => 0,
      getFilePath: () => '/tmp/page.html',
      getSelectedSid: () => null,
      applyOps: () => ({ ok: true, ranges: [] }),
      replaceAll: () => {},
    },
    getSnapshot: () => ({}),
    restoreSnapshot: () => {},
    onPrompt: () => {},
    onRunDone: () => {},
    clearHighlights: () => {},
    navigateTo: () => {},
    onBriefConfirmed: () => {},
    previewDraft: () => {},
  } as unknown as HtmlAiDeps

  function mount() {
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
              preset: { text: 'tighten the intro', nonce: 1 },
              onCollapse: () => {},
              editQueue: [],
              onQueueEditInstruction: () => {},
              onQueueRemove: () => {},
              onQueueClear: () => {},
              onQueueFocus: () => {},
              onQueueConsume: () => {},
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
    m.render('/docs/a.html')
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

  it('a restarted conversation keeps its note and no empty-reply line', async () => {
    await started()
    await notify({ kind: 'conversation-restarted' })
    await act(async () => harness.events.onDone({ text: '', cancelled: false, turnLimit: false }))
    expect(notices()).toEqual([ui('aiConversationRestarted')])
    expect(container!.textContent).not.toContain(t('aiNoReply'))
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
      ui('aiErrUnsupported', { module: 'HTML' }),
    ])
  })
})
