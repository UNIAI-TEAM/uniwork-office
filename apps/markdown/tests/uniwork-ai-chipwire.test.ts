// UniWork AI result chip wiring in the markdown panel (G6-05u visual r1 F1, F2, F3, F6, F11): an error turn offers
// its labelled action, the announcement is the line on screen, dropped calls read Chưa hỗ trợ, and the
// chip opens the answer paragraph. Same harness as uniwork-ai-notice.test.ts.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { aiUniworkText } from '@genoffice/ui'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
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

describe('UniWork AI chip wiring (markdown panel)', () => {
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

  /** mount, let the preset start its turn, return once the loop has handed over its events */
  async function started() {
    harness.events = null
    const m = mount()
    m.render('/docs/a.md')
    await flush()
    await flush()
    expect(harness.events, 'the turn started').not.toBeNull()
  }

  const root_ = () => container!
  const MODULE = 'Markdown'
  const uniworkTurn = async (): Promise<void> => {
    await started()
    ;(window as any).markdownApi.getAiSettings = vi.fn(async () => ({
      ...usableAiSettings(),
      provider: 'uniwork',
    }))
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
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

  // F12 (visual r2): the "not sent" bubble's own Retry sat next to the labelled S9 action on every UniWork
  // error. An S9 error turn has ONE action by code (EXPERIENCE S9): Retry only where the table allows it.
  const retryButtons = () => [
    ...root_().querySelectorAll<HTMLButtonElement>(
      '.ai-retry-btn, .ai-error-action button[data-action="retry"]',
    ),
  ]

  it.each([
    ['a retry-allowed code', 'aiErrUnavailable', 1],
    ['the generic error', 'aiErrGeneric', 0],
    ['offline', 'aiErrOffline', 0],
    ['revoked', 'aiErrRevoked', 0],
    ['credits exhausted', 'aiErrCredits', 0],
  ] as const)(
    'F12: a UniWork error turn for %s has exactly the S9 Retry count and no bubble Retry',
    async (_name, errKey, retries) => {
      await uniworkTurn()
      await failWith('x', errKey)
      expect(root_().querySelector('.ai-retry-btn'), 'no Retry on the user bubble').toBeNull()
      expect(retryButtons()).toHaveLength(retries)
      if (retries) {
        expect(root_().querySelector('.ai-error-action button')?.textContent).toBe(ui('aiRunRetry'))
      }
    },
  )

  it('F12: a failure that is not a UniWork error (own key) keeps the bubble Retry', async () => {
    await started()
    await failRaw('upstream said no')
    expect(root_().querySelector('.ai-error-action')).toBeNull()
    expect(root_().querySelectorAll('.ai-msg-undelivered .ai-retry-btn')).toHaveLength(1)
  })
})
