// G6-12 (UNI-1366) F1: after the user answers an ask_clarification card, the markdown panel keeps
// a styled "answered" receipt under the user message (html/pdf/slides do), so the chat does
// not lose the answers. A skip leaves no receipt; the receipt is view-only panel state that
// is dropped with its document (switch) and on New chat. Restored history only ever fills an
// empty chat here, so it can neither shift nor drop a live turn's receipt.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { strings } from '../src/renderer/i18n/strings'

// the loop is replaced by a fake whose run() asks one clarification and then finishes
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    constructor(readonly opts: any) {}
    async run(): Promise<void> {
      this.busy = true
      await this.opts.skill.executeTool({
        id: 'c1',
        name: 'ask_clarification',
        input: {
          questions: [{ id: 'tone', label: 'Which tone?', options: ['Formal', 'Casual'] }],
        },
      })
      this.busy = false
      this.opts.events.onDone({ text: 'done', cancelled: false })
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

describe('answered clarify receipts (markdown)', () => {
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

  async function reachCard(): Promise<void> {
    await flush()
    await flush()
    expect(container!.querySelector('.ai-clarify-opt'), 'the card is shown').not.toBeNull()
  }
  async function answerCard(): Promise<void> {
    await reachCard()
    await act(async () => container!.querySelector<HTMLElement>('.ai-clarify-opt')!.click())
    await act(async () => container!.querySelector<HTMLElement>('.ai-clarify-submit')!.click())
    await flush()
  }
  const receipts = () => container!.querySelectorAll('.ai-clarify-answered')

  it('shows the answered receipt under the user message', async () => {
    const m = mount()
    m.render('/notes/a.md')
    await answerCard()
    expect(receipts()).toHaveLength(1)
    expect(container!.querySelector('.ai-msg-user')!.contains(receipts()[0]!)).toBe(true)
    expect(receipts()[0]!.textContent).toContain('Which tone?')
    expect(receipts()[0]!.textContent).toContain('Formal')
  })

  it('leaves no receipt after a skip', async () => {
    const m = mount()
    m.render('/notes/a.md')
    await reachCard()
    await act(async () => container!.querySelector<HTMLElement>('.ai-clarify-skip')!.click())
    await flush()
    expect(receipts()).toHaveLength(0)
  })

  it('keeps the receipt while the document stays the same', async () => {
    const m = mount()
    m.render('/notes/a.md')
    await answerCard()
    m.render('/notes/a.md')
    expect(receipts()).toHaveLength(1)
  })

  it('drops the receipt when another document opens', async () => {
    const m = mount()
    m.render('/notes/a.md')
    await answerCard()
    m.render('/notes/b.md')
    await flush()
    expect(receipts()).toHaveLength(0)
  })

  it('keeps the receipt when an untitled document gets its first path (same document)', async () => {
    const m = mount()
    m.render(null)
    await answerCard()
    m.render('/notes/new.md')
    await flush()
    expect(receipts()).toHaveLength(1)
  })

  it('late restored history never replaces the live turn or moves its receipt', async () => {
    const m = mount('deferred')
    m.render('/notes/a.md')
    await answerCard()
    await act(async () => {
      resolveHistory([
        { role: 'user', text: 'older question' },
        { role: 'assistant', text: 'older answer' },
      ])
    })
    await flush()
    expect(container!.textContent).not.toContain('older question')
    expect(receipts()).toHaveLength(1)
    expect(container!.querySelector('.ai-msg-user')!.contains(receipts()[0]!)).toBe(true)
  })

  it('clears the receipt on New chat', async () => {
    const m = mount()
    m.render('/notes/a.md')
    await answerCard()
    const button = container!.querySelector<HTMLButtonElement>(
      `button[aria-label="${strings.en.aiNewChat}"]`,
    )!
    await act(async () => button.click())
    expect(receipts()).toHaveLength(0)
    expect(container!.querySelector('.ai-msg-user')).toBeNull()
  })
})
