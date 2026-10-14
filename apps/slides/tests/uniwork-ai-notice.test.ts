// UniWork AI notices in the slides panel (G6-05 slice D): a Retry-After wait is a status line
// with Stop only (no Retry while the run waits); a restarted conversation, a provider boundary
// and a dropped call are plain notes. The loop is replaced by a harness that hands over its events.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStreamNotice } from '@genoffice/agent-core'
import { aiUniworkText } from '@genoffice/ui'

const harness = vi.hoisted(() => ({
  events: null as null | {
    onText?: (text: string) => void
    onNotice?: (notice: unknown) => void
    onDone?: (result: { text: string; cancelled: boolean; turnLimit: boolean }) => void
    onError?: (error: string) => void
  },
  run: vi.fn(),
}))

vi.mock('@genoffice/agent-core', async () => {
  const actual =
    await vi.importActual<typeof import('@genoffice/agent-core')>('@genoffice/agent-core')
  return {
    ...actual,
    AgentLoop: class MockAgentLoop {
      busy = false
      constructor(options: { events?: typeof harness.events }) {
        harness.events = options.events ?? null
      }
      run(...args: unknown[]) {
        harness.run(...args)
      }
      cancel() {}
      reset() {}
      restore() {}
    },
  }
})

// react-konva's node entry requires the native 'canvas' package; these tests do not draw.
vi.mock('react-konva', () => {
  const stub = () => null
  return Object.fromEntries(
    [
      'Stage',
      'Layer',
      'Rect',
      'Group',
      'Transformer',
      'Line',
      'Arrow',
      'Text',
      'Ellipse',
      'Image',
      'Path',
      'Circle',
      'Arc',
    ].map((k) => [k, stub]),
  )
})

import { AiPanel } from '../src/renderer/ai/AiPanel'
import { getLang, LocaleProvider, setModuleLang, t } from '../src/renderer/i18n/locale'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'

const settings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: 'k', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

const mounted: Array<{ root: Root; container: HTMLElement }> = []
const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
const ui = (key: Parameters<typeof aiUniworkText>[1], params?: Record<string, string | number>) =>
  aiUniworkText(getLang(), key, params)

async function startRun(provider: AiSettings['provider'] = 'anthropic'): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(LocaleProvider, {
        initial: 'vi',
        children: createElement(AiPanel, {
          slides: [],
          current: 0,
          selectedIds: [],
          images: new Map(),
          applySlide: () => {},
          applyDeck: () => {},
          fitWidthPx: 960,
          settings: { ...settings, provider },
          open: true,
          onExpand: () => {},
          onCollapse: () => {},
          preset: { text: 'tighten it', nonce: 1, autoRun: true },
        }),
      }),
    ),
  )
  mounted.push({ root, container })
  await flush()
  expect(harness.run).toHaveBeenCalled()
  return container
}

const notify = (notice: AgentStreamNotice) => act(() => harness.events!.onNotice?.(notice))
const notices = (c: HTMLElement) =>
  [...c.querySelectorAll('.ai-msg-notice')].map((n) => n.textContent)

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
})

beforeEach(() => {
  // product copy is vi/en; the module default (zh) is not what users read here
  setModuleLang('vi')
  harness.events = null
  harness.run.mockReset()
  Object.defineProperty(window, 'slidesApi', {
    configurable: true,
    value: {
      aiGskStatus: vi.fn(async () => ({ loggedIn: true })),
      beginHistoryBatch: vi.fn(async () => false),
      endHistoryBatch: vi.fn(async () => null),
      aiLogRunFailure: vi.fn(async () => undefined),
      onLanguageChanged: () => () => {},
    },
  })
  Object.defineProperty(window, 'projectApi', { configurable: true, value: undefined })
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: { readAttachmentImage: vi.fn(async () => ({ ok: false })) },
  })
})

afterEach(() => {
  setModuleLang('zh')
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('UniWork AI notices (slides panel)', () => {
  it('waiting shows Stop only, no Retry', async () => {
    const c = await startRun()
    await notify({ kind: 'rate-limit-wait', seconds: 90, attempt: 1 })
    expect(notices(c)).toEqual([ui('aiErrRateLimited', { seconds: 90 })])
    // the copy itself is pinned in the product languages, not only echoed through aiUniworkText
    expect(notices(c)).toEqual(['Bạn đang gửi quá nhanh. Thử lại sau 90 giây.'])
    expect(c.querySelector(`button[aria-label="${t('aiStop')}"]`), 'Stop stays').not.toBeNull()
    expect(c.querySelector(`button[aria-label="${t('aiRegenerate')}"]`)).toBeNull()
    expect(c.querySelector('.ai-msg-error')).toBeNull()
    // the resend streams text: the line goes
    await act(async () => harness.events!.onText?.('done it'))
    expect(notices(c)).toEqual([])
  })

  const regenerate = (c: HTMLElement) =>
    c.querySelector<HTMLButtonElement>(`button[aria-label="${t('aiRegenerate')}"]`)

  it('a wait that gives up ends as an error and Retry IS offered', async () => {
    const c = await startRun()
    await notify({ kind: 'rate-limit-wait', seconds: 5, attempt: 1 })
    // the positive control of the wait test: no regenerate while waiting ...
    expect(regenerate(c)).toBeNull()
    await act(async () => harness.events!.onError?.('too fast'))
    await flush()
    expect(notices(c)).toEqual([])
    // ... and the same control is there once the wait gave up, so the null above can fail
    expect(regenerate(c), 'Retry after the give-up').not.toBeNull()
  })

  it('a wait after an earlier failed turn still shows Stop only', async () => {
    const c = await startRun()
    await act(async () => harness.events!.onError?.('first failed'))
    await flush()
    const retry = regenerate(c)
    expect(retry, 'Retry after the first failure').not.toBeNull()
    await act(async () => retry!.click())
    await flush()
    await notify({ kind: 'rate-limit-wait', seconds: 30, attempt: 1 })
    expect(notices(c)).toEqual([ui('aiErrRateLimited', { seconds: 30 })])
    expect(c.querySelector(`button[aria-label="${t('aiStop')}"]`), 'Stop stays').not.toBeNull()
    expect(regenerate(c)).toBeNull()
  })

  it('one persistent aria-live region is mounted before the notice, and the note lands inside it', async () => {
    const c = await startRun()
    const chatEl = c.querySelector('.ai-chat')
    expect(chatEl?.hasAttribute('aria-live')).toBe(false)
    expect(chatEl?.getAttribute('aria-busy')).toBe('true')
    expect(c.querySelector('.ai-msg-assistant [aria-live]')).toBeNull()
    const live = c.querySelector('.ai-sr-status')
    expect(live, 'live region before any notice').not.toBeNull()
    expect(live!.getAttribute('aria-live')).toBe('polite')
    expect(live!.textContent).toBe('')
    // a plain aria-live container: role=status would collide with the app's own status nodes
    expect(live!.hasAttribute('role')).toBe(false)
    await notify({ kind: 'rate-limit-wait', seconds: 30, attempt: 1 })
    // the same node (not a new one mounted with its text) now holds the note, and nothing else in .ai-chat announces
    expect(c.querySelector('.ai-sr-status')).toBe(live)
    expect(c.querySelectorAll('[aria-live]')).toHaveLength(1)
    expect(c.querySelectorAll('[role="status"]:not(.ai-typing)')).toHaveLength(0)
    expect(live!.textContent).toBe(ui('aiErrRateLimited', { seconds: 30 }))
    expect(c.querySelectorAll('.ai-msg-notice [role="status"]')).toHaveLength(0)
    expect(c.querySelectorAll('.ai-msg-notice')).toHaveLength(1)
    // a restart note joins the wait line in the same region
    await notify({ kind: 'conversation-restarted' })
    expect(live!.textContent).toContain(ui('aiConversationRestarted'))
  })

  it('a restarted conversation keeps its note and no empty-reply line', async () => {
    const c = await startRun()
    await notify({ kind: 'conversation-restarted' })
    await act(async () =>
      harness.events!.onDone?.({ text: '', cancelled: false, turnLimit: false }),
    )
    await flush()
    expect(c.querySelectorAll('[role="status"]')).toHaveLength(0)
    expect(notices(c)).toEqual([ui('aiConversationRestarted')])
    expect(c.textContent).not.toContain(t('aiNoResponse'))
    // the turn ended quietly: no error line, no Retry, and the question is back in the composer
    expect(c.querySelector('.ai-msg-error')).toBeNull()
    expect(c.querySelector('.ai-retry-btn')).toBeNull()
    expect(c.querySelector('textarea')?.value).toBe('tighten it')
  })

  it.each([['aiErrQuestionTooLong'], ['aiErrQuestionRejected']] as const)(
    'a refused question (%s) shows its error, offers no Retry or regenerate, and puts the question back in the composer',
    async (key) => {
      const c = await startRun()
      await act(async () => harness.events!.onError?.(ui(key)))
      await flush()
      expect(c.querySelector('.ai-msg-error')?.textContent).toContain(ui(key))
      expect(c.querySelector('.ai-retry-btn')).toBeNull()
      expect(c.querySelector(`button[aria-label="${t('aiRegenerate')}"]`)).toBeNull()
      expect(c.querySelector('textarea')?.value).toBe('tighten it')
    },
  )

  it('another failure still offers regenerate and leaves the composer alone (control)', async () => {
    const c = await startRun()
    await act(async () => harness.events!.onError?.('server fell over'))
    await flush()
    expect(c.querySelector('.ai-msg-error')).not.toBeNull()
    expect(c.querySelector(`button[aria-label="${t('aiRegenerate')}"]`)).not.toBeNull()
    expect(c.querySelector('textarea')?.value).toBe('')
  })

  it('UniWork AI off: one note, no error line, no Retry or regenerate, no empty-reply line', async () => {
    const c = await startRun()
    await notify({ kind: 'uniwork-off' })
    await act(async () =>
      harness.events!.onDone?.({ text: '', cancelled: false, turnLimit: false }),
    )
    await flush()
    expect(notices(c)).toEqual([ui('aiUniworkOff')])
    expect(c.querySelector('.ai-msg-error')).toBeNull()
    expect(c.querySelector('.ai-retry-btn')).toBeNull()
    expect(c.querySelector(`button[aria-label="${t('aiRegenerate')}"]`)).toBeNull()
    expect(c.textContent).not.toContain(t('aiNoResponse'))
  })

  it('a provider boundary and dropped calls become notes', async () => {
    const c = await startRun()
    await notify({ kind: 'conversation-boundary', provider: 'UniWork AI' })
    await notify({
      kind: 'dropped-tool-calls',
      calls: [
        { index: 0, name: 'edit', reason: 'view_only' },
        { index: 1, name: 'x', reason: 'not_allowlisted' },
      ],
    })
    expect(notices(c)).toEqual([
      ui('aiConversationBoundary', { provider: 'UniWork AI' }),
      ui('aiErrViewOnlyEdit'),
      ui('aiErrUnsupported', { module: 'Slides' }),
    ])
  })

  it('when UniWork AI is selected, renders result chip as first words of answer node and announces once in panel live node', async () => {
    const c = await startRun('uniwork')
    const chatEl = c.querySelector('.ai-chat')
    expect(chatEl?.hasAttribute('aria-live')).toBe(false)
    expect(chatEl?.getAttribute('aria-busy')).toBe('true')
    await act(async () => harness.events!.onText?.('Bố cục trang 1 đã gọn hơn.'))
    await act(async () =>
      harness.events!.onDone?.({
        text: 'Bố cục trang 1 đã gọn hơn.',
        cancelled: false,
        turnLimit: false,
      }),
    )
    await flush()
    expect(chatEl?.hasAttribute('aria-busy')).toBe(false)
    const chipEl = c.querySelector('.ai-result-chip')
    expect(chipEl).not.toBeNull()
    expect(chipEl?.textContent).toBe(ui('aiResultAnswer'))
    const answerNode = chipEl?.parentElement
    expect(answerNode?.textContent?.startsWith(`${ui('aiResultAnswer')}:`)).toBe(true)
    const live = c.querySelector('.ai-sr-status')
    expect(live?.textContent).toBe(ui('aiResultAnswer'))
    expect(live?.textContent).not.toContain('Bố cục trang 1 đã gọn hơn.')
  })

  it('clicking Stop returns keyboard focus to the composer textarea (RF1-12, RF1-23b)', async () => {
    const c = await startRun()
    const stopBtn = c.querySelector<HTMLButtonElement>(`button[aria-label="${t('aiStop')}"]`)
    expect(stopBtn).not.toBeNull()
    stopBtn!.focus()
    await act(async () => stopBtn!.click())
    await flush()
    expect(document.activeElement).toBe(c.querySelector('textarea'))
  })
})
