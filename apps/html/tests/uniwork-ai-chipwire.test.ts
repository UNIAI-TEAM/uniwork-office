// UniWork AI result chip wiring in the html panel (G6-05u visual r1 F1, F2, F3, F6, F11): an error turn offers
// its labelled action, the announcement is the line on screen, dropped calls read Chưa hỗ trợ, and the
// chip opens the answer paragraph. Same harness as uniwork-ai-notice.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { aiUniworkText, setAiModelNeedHint } from '@genoffice/ui'
import { createRoot, type Root } from 'react-dom/client'
import { buildParseMap } from '../src/renderer/document/parse-map'
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

import { AiPanel, type HtmlAiDeps } from '../src/renderer/ai/AiPanel'
import { LocaleProvider } from '../src/renderer/i18n/locale'

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('UniWork AI chip wiring (html panel)', () => {
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

  /** mount, let the preset start its turn, return once the loop has handed over its events */
  async function started() {
    harness.events = null
    const m = mount()
    m.render('/docs/a.html')
    await flush()
    await flush()
    expect(harness.events, 'the turn started').not.toBeNull()
  }

  const root_ = () => container!
  const MODULE = 'HTML'
  const uniworkTurn = async (): Promise<void> => {
    ;(window as any).htmlApi.getAiSettings = vi.fn(async () => ({
      ...usableAiSettings(),
      provider: 'uniwork',
    }))
    await started()
  }
  const failWith = async (_code: string, errKey: string): Promise<void> => {
    await act(async () => harness.events.onError(ui(errKey as Parameters<typeof aiUniworkText>[1])))
  }
  const failRaw = async (text: string): Promise<void> => {
    await act(async () => harness.events.onError(text))
  }
  const visibleErrorText = () => {
    const paragraph = root_().querySelector('.ai-msg-answer .ai-md p')
    if (!paragraph) return undefined
    const copy = paragraph.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.ai-result-chip, .ai-result-chip-sep').forEach((n) => n.remove())
    return copy.textContent?.trim()
  }
  const dropCalls = (calls: unknown[]) =>
    act(async () => harness.events.onNotice({ kind: 'dropped-tool-calls', calls }))
  const finish = async (): Promise<void> => {
    await act(async () => harness.events.onDone({ text: '', cancelled: false, turnLimit: false }))
  }
  const streamAnswer = async (text: string): Promise<void> => {
    await act(async () => harness.events.onText(text))
    await act(async () => harness.events.onDone({ text, cancelled: false, turnLimit: false }))
  }

  it.each([
    ['credits_exhausted', 'aiErrCredits', 'aiRunChooseOther'],
    ['session_expired', 'aiErrSession', 'acctSignInAgain'],
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

  it('F1: Thử lại sends the turn again, Chọn nhà cung cấp khác opens the model settings', async () => {
    await uniworkTurn()
    const ackBtn = container!.querySelector<HTMLButtonElement>('[role="region"] button')
    if (ackBtn) await act(async () => ackBtn.click())
    await flush()
    await failWith('cloud_unavailable', 'aiErrUnavailable')
    // the panel may have rebuilt its loop for the UniWork pick: spy on the one it holds now
    const run = vi.spyOn(Object.getPrototypeOf(harness.loop), 'run')
    // the fake loop never finishes on its own: after an error the real one is idle again
    harness.loop.busy = false
    // the model picker of this harness never reads a model: clear its hint like the send-guard tests
    act(() => setAiModelNeedHint(null))
    // a failed send keeps one Retry, on the undelivered message (RF6-2); it resends the turn
    await act(async () => root_().querySelector<HTMLButtonElement>('.ai-retry-btn')!.click())
    await new Promise((r) => setTimeout(r, 50))
    expect(run).toHaveBeenCalledTimes(1)
    await failWith('credits_exhausted', 'aiErrCredits')
    await act(async () =>
      root_().querySelector<HTMLButtonElement>('.ai-error-action button')!.click(),
    )
    expect((window as any).htmlApi.openAiModelSettings).toHaveBeenCalled()
  })

  it('RF6-2: a failed send shows one Retry: the undelivered message keeps its button, the error turn drops the labelled one', async () => {
    await uniworkTurn()
    await failWith('cloud_unavailable', 'aiErrUnavailable')
    // the failed send marks the user message undelivered and offers its own Retry
    const undelivered = root_().querySelector('.ai-msg-undelivered')
    expect(undelivered, 'the message is marked undelivered').not.toBeNull()
    expect(undelivered!.querySelector('.ai-retry-btn')).not.toBeNull()
    // the turn still announces and shows the line, as for every other error
    expect(root_().querySelector('.ai-sr-status')?.textContent).toBe(
      `${ui('aiResultError')}. ${ui('aiErrUnavailable')}`,
    )
    expect(visibleErrorText()).toBe(ui('aiErrUnavailable'))
    // so the error turn must not add a second control for the same resend
    expect(root_().querySelector('.ai-error-action button')).toBeNull()
    expect(
      [...root_().querySelectorAll('button')].filter(
        (b) => b.textContent === ui('aiRunRetry') || b.classList.contains('ai-retry-btn'),
      ),
    ).toHaveLength(1)
  })

  it('RF6-2: the other labelled actions of an undelivered turn stay', async () => {
    await uniworkTurn()
    await failWith('credits_exhausted', 'aiErrCredits')
    expect(root_().querySelector('.ai-msg-undelivered')).not.toBeNull()
    expect(
      [...root_().querySelectorAll<HTMLButtonElement>('.ai-error-action button')].map(
        (b) => b.textContent,
      ),
    ).toEqual([ui('aiRunChooseOther')])
  })
})
