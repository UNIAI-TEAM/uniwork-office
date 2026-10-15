// A picked UniWork AI that is not offered keeps every send entry closed (spec S7 / RF1-4): the
// composer already has Send off; a ribbon preset, retry or queue run goes through the same panel
// send() and must not start a turn (no bubble, no loop run) while the model-need hint is on.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { setAiModelNeedHint } from '@genoffice/ui'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'

const harness = vi.hoisted(() => ({
  runs: [] as string[],
  finishRun: null as (() => void) | null,
}))
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    private events:
      | {
          onDone?: (r: {
            text: string
            cancelled: boolean
            turnLimit: boolean
            truncated: boolean
          }) => void
        }
      | undefined
    constructor(opts?: { events?: FakeLoop['events'] }) {
      this.events = opts?.events
    }
    async run(instruction: string): Promise<void> {
      harness.runs.push(instruction)
      this.busy = true
      harness.finishRun = () => {
        this.busy = false
        this.events?.onDone?.({
          text: 'reply',
          cancelled: false,
          turnLimit: false,
          truncated: false,
        })
      }
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

function enqueueInComposer(container: HTMLElement, text: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

describe('markdown panel send entry with an unavailable UniWork AI pick', () => {
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
    harness.runs.length = 0
    harness.finishRun = null
    act(() => setAiModelNeedHint(null))
    setUniworkAiAvailable(false)
    vi.unstubAllGlobals()
  })

  /** mount with `provider` saved, let the picker publish its need, then fire a ribbon preset */
  async function mountThenPreset(provider: 'uniwork' | 'openai') {
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
                ? vi.fn(async () => ({ ...usableAiSettings(), provider }))
                : vi.fn(async () => undefined)
          }
          return target[prop]
        },
      }),
    )
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
    const render = (nonce: number | null) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(AiPanel, {
              deps,
              filePath: '/docs/a.md',
              onCollapse: () => {},
              ...(nonce === null ? {} : { preset: { text: 'rewrite it', nonce } }),
            }),
          ),
        ),
      )
    render(null)
    await flush()
    await flush()
    render(1)
    await flush()
    await flush()
  }

  it('uniwork picked and not offered: a preset starts no turn and leaves no bubble', async () => {
    await mountThenPreset('uniwork')
    expect(harness.runs).toEqual([])
    expect(container!.querySelector('.ai-msg-user')).toBeNull()
  })

  it('a usable provider still runs the same preset (the guard is the hint, nothing else)', async () => {
    await mountThenPreset('openai')
    expect(harness.runs).toHaveLength(1)
    expect(container!.querySelector('.ai-msg-user')).not.toBeNull()
  })

  it('a queued item stays queued and sends no request when the model-need hint turns on before settle (RF3-3)', async () => {
    await mountThenPreset('openai')
    expect(harness.runs).toEqual(['rewrite it'])
    enqueueInComposer(container!, 'queued follow-up')
    expect(container!.querySelector('.ai-queue-strip')).not.toBeNull()

    act(() => setAiModelNeedHint('Choose a model to send'))
    act(() => harness.finishRun?.())
    await flush()
    await flush()

    expect(harness.runs).toEqual(['rewrite it'])
    expect(container!.querySelectorAll('.ai-msg-user')).toHaveLength(1)
    expect(container!.querySelector('.ai-queue-strip')).not.toBeNull()
  })
})
