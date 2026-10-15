// UniWork AI result chip wiring in the slides panel (G6-05u visual r1 F1, F2, F3, F6, F11): an error turn offers
// its labelled action, the announcement is the line on screen, dropped calls read Chưa hỗ trợ, and the
// chip opens the answer paragraph. Same harness as uniwork-ai-notice.test.ts.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStreamNotice } from '@genoffice/agent-core'
import { aiUniworkText, clearUniworkAcks } from '@genoffice/ui'

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
  const render = (preset?: { text: string; nonce: number; autoRun: boolean }) =>
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
            preset,
          }),
        }),
      ),
    )
  const preset = { text: 'tighten it', nonce: 1, autoRun: true }
  mounted.push({ root, container })
  if (provider === 'uniwork') {
    // a preset is refused until the UniWork disclosure is acknowledged (S8): mount, acknowledge
    // the way a user does, then fire the preset
    render()
    await flush()
    act(() => {
      container.querySelector<HTMLButtonElement>('[role="region"] button')!.click()
    })
    await flush()
  }
  render(preset)
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
  // the in-memory empty-account ack must not leak into the next test
  clearUniworkAcks()
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('UniWork AI chip wiring (slides panel)', () => {
  let current: HTMLElement | null = null
  const root_ = () => current!
  const MODULE = 'Slides'
  const uniworkTurn = async (): Promise<void> => {
    current = await startRun('uniwork')
  }
  const failWith = async (_code: string, errKey: string): Promise<void> => {
    await act(async () =>
      harness.events!.onError?.(ui(errKey as Parameters<typeof aiUniworkText>[1])),
    )
  }
  const failRaw = async (text: string): Promise<void> => {
    await act(async () => harness.events!.onError?.(text))
  }
  const visibleErrorText = () => root_().querySelector('.ai-msg-error')?.textContent
  const dropCalls = (calls: unknown[]) =>
    act(async () => harness.events!.onNotice?.({ kind: 'dropped-tool-calls', calls }))
  const finish = async (): Promise<void> => {
    await act(async () =>
      harness.events!.onDone?.({ text: '', cancelled: false, turnLimit: false }),
    )
    await flush()
  }
  const streamAnswer = async (text: string): Promise<void> => {
    await act(async () => harness.events!.onText?.(text))
    await act(async () => harness.events!.onDone?.({ text, cancelled: false, turnLimit: false }))
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
})
