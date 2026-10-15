// A picked UniWork AI that is not offered keeps every send entry closed (spec S7 / RF1-4): the
// composer already has Send off; a ribbon preset, retry, continue or queue run goes through the
// same panel runWith() and must not start a turn (no bubble, no loop run) while the model-need
// hint is on.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'

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

import { AiPanel } from '../src/renderer/ai/AiPanel'

const settingsFor = (provider: AiSettings['provider']): AiSettings => ({
  provider,
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [
      p.id,
      { apiKey: p.id === 'anthropic' ? 'test-key' : '', model: p.defaultModel },
    ]),
  ) as AiSettings['providers'],
})

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

describe('docs panel send entry with an unavailable UniWork AI pick', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null

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
    harness.runs.length = 0
    harness.finishRun = null
    act(() => setAiModelNeedHint(null))
    // the in-memory empty-account ack must not leak into the next test
    clearUniworkAcks()
    setUniworkAiAvailable(false)
    delete (window as any).desktop
  })

  /** mount with `provider` saved, let the picker publish its need, then fire an auto-run preset */
  async function mountThenPreset(provider: AiSettings['provider']) {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'docParagraph',
            attrs: { docxIndex: 0 },
            content: [{ type: 'text', text: 'Saved document' }],
          },
        ],
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const settings = settingsFor(provider)
    // the model chip (and so the need hint) reads the saved settings through the preload bridge
    const stubs: Record<string, unknown> = { capabilities: { platform: 'desktop' } }
    ;(window as any).desktop = new Proxy(stubs, {
      get(target, prop: string) {
        if (!(prop in target)) {
          target[prop] = /^on[A-Z]/.test(prop)
            ? vi.fn(() => () => {})
            : prop === 'getAiSettings'
              ? vi.fn(async () => settings)
              : prop === 'aiGskStatus'
                ? vi.fn(async () => ({ loggedIn: false }))
                : vi.fn(async () => undefined)
        }
        return target[prop]
      },
    })
    const render = (nonce: number | null) =>
      act(() =>
        root!.render(
          createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings,
            open: true,
            ...(nonce === null ? {} : { preset: { text: 'rewrite it', autoRun: true, nonce } }),
          } as never),
        ),
      )
    render(null)
    await flush()
    await flush()
    render(1)
    await flush()
    await flush()
    return {
      /** the user picks `next` in the model picker: the panel gets new settings */
      pick: async (next: AiSettings['provider'], nonce = 1) => {
        const picked = settingsFor(next)
        act(() =>
          root!.render(
            createElement(AiPanel, {
              editor: editor!,
              blocks: [],
              settings: picked,
              open: true,
              preset: { text: 'rewrite it', autoRun: true, nonce },
            } as never),
          ),
        )
        await flush()
      },
      /** a fresh ribbon preset (a new nonce) with `provider` still picked */
      firePreset: async (nonce: number, open = true) => {
        act(() =>
          root!.render(
            createElement(AiPanel, {
              editor: editor!,
              blocks: [],
              settings: settingsFor('uniwork'),
              open,
              preset: { text: 'rewrite it', autoRun: true, nonce },
            } as never),
          ),
        )
        await flush()
        await flush()
      },
    }
  }

  it('uniwork picked and not offered: a preset starts no turn and leaves no bubble', async () => {
    await mountThenPreset('uniwork')
    expect(harness.runs).toEqual([])
    expect(container!.querySelector('.ai-msg-user')).toBeNull()
  })

  it('a usable provider still runs the same preset (the guard is the hint, nothing else)', async () => {
    await mountThenPreset('anthropic')
    expect(harness.runs).toHaveLength(1)
    expect(container!.querySelector('.ai-msg-user')).not.toBeNull()
  })

  it('a queued item stays queued and sends no request when the model-need hint turns on before settle (RF3-3)', async () => {
    await mountThenPreset('anthropic')
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

  it('a queued item stays queued while UniWork AI is picked with an unacknowledged disclosure, and sends after the ack (RF4-1)', async () => {
    const panel = await mountThenPreset('anthropic')
    expect(harness.runs).toEqual(['rewrite it'])
    enqueueInComposer(container!, 'queued follow-up')

    // the hint holds the item while the run settles, then the user picks UniWork AI
    act(() => setAiModelNeedHint('Choose a model to send'))
    act(() => harness.finishRun?.())
    await flush()
    setUniworkAiAvailable(true)
    await panel.pick('uniwork')
    act(() => setAiModelNeedHint(null))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900))
    })

    expect(container!.querySelector('[role="region"]')).not.toBeNull()
    expect(harness.runs).toEqual(['rewrite it'])
    expect(container!.querySelector('.ai-queue-strip')).not.toBeNull()

    act(() => {
      container!.querySelector<HTMLButtonElement>('[role="region"] button')!.click()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900))
    })
    expect(harness.runs).toEqual(['rewrite it', 'queued follow-up'])
  })

  it('a preset with UniWork AI picked and the disclosure unacknowledged sends nothing, moves focus to the disclosure, and runs after the ack (core4b)', async () => {
    const panel = await mountThenPreset('anthropic')
    expect(harness.runs).toEqual(['rewrite it'])
    act(() => harness.finishRun?.())
    await flush()
    setUniworkAiAvailable(true)
    await panel.pick('uniwork')
    act(() => setAiModelNeedHint(null))

    await panel.firePreset(2)
    const region = container!.querySelector<HTMLElement>('[role="region"]')
    expect(region).not.toBeNull()
    expect(harness.runs).toEqual(['rewrite it'])
    expect(document.activeElement).toBe(region)

    act(() => {
      region!.querySelector<HTMLButtonElement>('button')!.click()
    })
    await panel.firePreset(3)
    expect(harness.runs).toEqual(['rewrite it', 'rewrite it'])
  })

  it('a preset that fires while the panel is collapsed to its rail is refused too: the gate does not need the composer mounted (core4b)', async () => {
    const panel = await mountThenPreset('anthropic')
    act(() => harness.finishRun?.())
    await flush()
    setUniworkAiAvailable(true)
    await panel.pick('uniwork')
    act(() => setAiModelNeedHint(null))

    await panel.firePreset(2, false)
    expect(container!.querySelector('[role="region"]')).toBeNull()
    expect(harness.runs).toEqual(['rewrite it'])
  })
})
