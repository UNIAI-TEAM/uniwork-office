// G6-12 (UNI-1366) F1: after the user answers an ask_clarification card, the docs panel keeps
// a styled "answered" receipt under the user message (html/pdf/slides do), so the chat does
// not lose the answers. A skip leaves no receipt; the receipt is view-only panel state that
// is dropped with its document (switch), when restored history lands, and on New chat.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { t } from '../src/renderer/i18n/locale'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'

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

import { AiPanel } from '../src/renderer/ai/AiPanel'

const settings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: '', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('answered clarify receipts (docs)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null
  let resolveHistory: (msgs: unknown[]) => void = () => {}

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy()
    root = null
    container = null
    editor = null
    delete (window as any).projectApi
  })

  function mount(history: 'none' | 'deferred' = 'none') {
    if (history === 'deferred') {
      ;(window as any).projectApi = {
        resolveChat: async () => ({ projectId: 'p', chatId: 'c' }),
        loadChat: () => new Promise((resolve) => (resolveHistory = resolve)),
        appendChat: async () => {},
        rebindChat: async () => null,
      }
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
    const render = (filePath: string | null) =>
      act(() =>
        root!.render(
          createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings,
            open: true,
            filePath,
            preset: { text: 'rewrite it', nonce: 1, autoRun: true },
          }),
        ),
      )
    return { render }
  }

  /** run the fake turn up to the card, then answer or skip it */
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
    m.render('/docs/a.docx')
    await answerCard()
    expect(receipts()).toHaveLength(1)
    const userMsg = container!.querySelector('.ai-msg-user')!
    expect(userMsg.contains(receipts()[0]!)).toBe(true)
    expect(receipts()[0]!.textContent).toContain('Which tone?')
    expect(receipts()[0]!.textContent).toContain('Formal')
  })

  it('leaves no receipt after a skip', async () => {
    const m = mount()
    m.render('/docs/a.docx')
    await reachCard()
    const skip = container!.querySelector<HTMLElement>('.ai-clarify-skip')!
    await act(async () => skip.click())
    await flush()
    expect(receipts()).toHaveLength(0)
  })

  it('keeps the receipt while the document stays the same', async () => {
    const m = mount()
    m.render('/docs/a.docx')
    await answerCard()
    m.render('/docs/a.docx')
    expect(receipts()).toHaveLength(1)
  })

  it('drops the receipt when another document opens', async () => {
    const m = mount()
    m.render('/docs/a.docx')
    await answerCard()
    m.render('/docs/b.docx')
    await flush()
    expect(receipts()).toHaveLength(0)
  })

  it('keeps the receipt when an untitled document gets its first path (same document)', async () => {
    const m = mount()
    m.render(null)
    await answerCard()
    m.render('/docs/new.docx')
    await flush()
    expect(receipts()).toHaveLength(1)
  })

  it('drops the receipt when restored history lands', async () => {
    const m = mount('deferred')
    m.render('/docs/a.docx')
    await answerCard()
    await act(async () => {
      resolveHistory([
        { role: 'user', text: 'older question' },
        { role: 'assistant', text: 'older answer' },
      ])
    })
    await flush()
    expect(container!.textContent).toContain('older question')
    expect(receipts()).toHaveLength(0)
  })

  it('clears the receipt on New chat', async () => {
    const m = mount()
    m.render('/docs/a.docx')
    await answerCard()
    const button = container!.querySelector<HTMLButtonElement>(
      `button[aria-label="${t('aiNewChatTitle')}"]`,
    )!
    await act(async () => button.click())
    expect(receipts()).toHaveLength(0)
    expect(container!.querySelector('.ai-msg-user')).toBeNull()
  })
})
