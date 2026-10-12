// G6-12 (UNI-1366) review fix: an answered ask_clarification receipt is view-only panel
// state keyed by chat message index. It must not outlive its document (switch) or its
// indexes (history reload prepends restored messages), or it renders under another message.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// the loop is replaced by a fake whose run() asks one clarification and then finishes
const loops = vi.hoisted(() => ({ last: null as null | { opts: any } }))
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    constructor(readonly opts: any) {
      loops.last = this
    }
    async run(): Promise<void> {
      this.busy = true
      await this.opts.skill.executeTool({
        id: 'c1',
        name: 'ask_clarification',
        input: { questions: [{ id: 'scope', label: 'Which pages?', options: ['All', 'Selection'] }] },
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

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('answered clarify receipts (pdf)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let resolveHistory: (msgs: unknown[]) => void = () => {}

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
    }
    if (history === 'deferred') {
      ;(window as any).projectApi = {
        resolveChat: async () => ({ projectId: 'p', chatId: 'c' }),
        loadChat: () => new Promise((resolve) => (resolveHistory = resolve)),
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
          createElement(AiPanel, {
            api: api as never,
            filePath,
            onCollapse: () => {},
            open: true,
            preset: { text: 'which pages?', nonce },
          }),
        ),
      )
    return { render }
  }

  /** run the fake turn up to the card, answer it, return once the receipt is on screen */
  async function answerCard(): Promise<void> {
    await flush()
    await flush()
    const radio = container!.querySelector<HTMLElement>('.ai-clarify-opt')
    expect(radio, 'the card is shown').not.toBeNull()
    await act(async () => radio!.click())
    await act(async () => container!.querySelector<HTMLElement>('.ai-clarify-submit')!.click())
    await flush()
    expect(container!.querySelectorAll('.ai-clarify-answered')).toHaveLength(1)
  }

  it('keeps the receipt under its message while the document stays the same', async () => {
    const m = mount()
    m.render('/docs/a.pdf')
    await answerCard()
    m.render('/docs/a.pdf', 1)
    expect(container!.querySelectorAll('.ai-clarify-answered')).toHaveLength(1)
  })

  it('drops the receipts when another document opens', async () => {
    const m = mount()
    m.render('/docs/a.pdf')
    await answerCard()
    m.render('/docs/b.pdf', 1)
    await flush()
    expect(container!.querySelectorAll('.ai-clarify-answered')).toHaveLength(0)
  })

  it('keeps the receipts when an untitled document gets its first path (same document)', async () => {
    const m = mount()
    m.render(undefined)
    await answerCard()
    m.render('/docs/new.pdf', 1)
    await flush()
    expect(container!.querySelectorAll('.ai-clarify-answered')).toHaveLength(1)
  })

  it('drops the receipts when restored history is prepended (indexes shift)', async () => {
    const m = mount('deferred')
    m.render('/docs/a.pdf')
    await answerCard()
    await act(async () => {
      resolveHistory([
        { role: 'user', text: 'older question' },
        { role: 'assistant', text: 'older answer' },
      ])
    })
    await flush()
    expect(container!.textContent).toContain('older question')
    expect(container!.querySelectorAll('.ai-clarify-answered')).toHaveLength(0)
  })
})
