// G6-12 (UNI-1366) review fix: an answered ask_clarification receipt is view-only panel
// state keyed by chat message index; it must not outlive its document.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { buildParseMap } from '../src/renderer/document/parse-map'

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
        input: { questions: [{ id: 'aud', label: 'Audience?', options: ['board', 'team'] }] },
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

import { AiPanel, type HtmlAiDeps } from '../src/renderer/ai/AiPanel'
import { LocaleProvider } from '../src/renderer/i18n/locale'

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('answered clarify receipts (html)', () => {
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

  it('keeps the receipt while the document stays the same', async () => {
    const m = mount()
    m.render('/docs/a.html')
    await answerCard()
    m.render('/docs/a.html')
    expect(container!.querySelectorAll('.ai-clarify-answered')).toHaveLength(1)
  })

  it('drops the receipts when another document opens', async () => {
    const m = mount()
    m.render('/docs/a.html')
    await answerCard()
    m.render('/docs/b.html')
    await flush()
    expect(container!.querySelectorAll('.ai-clarify-answered')).toHaveLength(0)
  })

  it('keeps the receipts when an untitled document gets its first path (same document)', async () => {
    const m = mount()
    m.render(null)
    await answerCard()
    m.render('/docs/new.html')
    await flush()
    expect(container!.querySelectorAll('.ai-clarify-answered')).toHaveLength(1)
  })
})
