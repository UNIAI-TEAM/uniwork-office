// UniWork AI not offered keeps every send entry closed (spec S7 / RF1-4): the composer already has
// Send off; a ribbon preset, retry, continue or queue run goes through the same panel runWith() and
// must not start a turn (no bubble, no loop run) while the model-need hint is on. UniWork AI is the
// one provider (UNI-2309), so its disclosure gates every send entry too.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { aiUniworkText, clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { ackUniworkDisclosureInFile } from '../../../packages/ui/tests/helpers/uniwork-ack'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { defaultAiSettings } from '@genoffice/ai-provider'

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

describe('docs panel send entry while UniWork AI cannot send', () => {
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

  /**
   * mount (UniWork AI offered or not, its disclosure of the untitled document acknowledged or not),
   * let the picker publish its need, then fire an auto-run preset
   */
  async function mountThenPreset(opts: { offered: boolean; acked: boolean }) {
    setUniworkAiAvailable(opts.offered)
    if (opts.acked) ackUniworkDisclosureInFile('local')
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
    const settings = defaultAiSettings()
    const expand = vi.fn()
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
    const render = (opts2: { nonce?: number; open?: boolean; filePath?: string }) =>
      act(() =>
        root!.render(
          createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings,
            open: opts2.open ?? true,
            onExpand: expand,
            ...(opts2.filePath ? { filePath: opts2.filePath } : {}),
            ...(opts2.nonce === undefined
              ? {}
              : { preset: { text: 'rewrite it', autoRun: true, nonce: opts2.nonce } }),
          } as never),
        ),
      )
    render({})
    await flush()
    await flush()
    render({ nonce: 1 })
    await flush()
    await flush()
    return {
      expand,
      /** another document opens in the same panel: its disclosure is not acknowledged yet */
      openDocument: async (filePath: string) => {
        render({ nonce: 1, filePath })
        await flush()
      },
      /** a fresh ribbon preset (a new nonce) */
      firePreset: async (nonce: number, open = true) => {
        render({ nonce, open })
        await flush()
        await flush()
      },
    }
  }

  it('not offered: a preset starts no turn and leaves no bubble', async () => {
    await mountThenPreset({ offered: false, acked: true })
    expect(harness.runs).toEqual([])
    expect(container!.querySelector('.ai-msg-user')).toBeNull()
  })

  it('offered and acknowledged: the same preset runs (the guard is the hint, nothing else)', async () => {
    await mountThenPreset({ offered: true, acked: true })
    expect(harness.runs).toHaveLength(1)
    expect(container!.querySelector('.ai-msg-user')).not.toBeNull()
  })

  it('a queued item stays queued and sends no request when the model-need hint turns on before settle (RF3-3)', async () => {
    await mountThenPreset({ offered: true, acked: true })
    expect(harness.runs).toEqual(['rewrite it'])
    enqueueInComposer(container!, 'queued follow-up')
    expect(container!.querySelector('.ai-queue-strip')).not.toBeNull()

    act(() => setAiModelNeedHint('UniWork AI is not on here'))
    act(() => harness.finishRun?.())
    await flush()
    await flush()

    expect(harness.runs).toEqual(['rewrite it'])
    expect(container!.querySelectorAll('.ai-msg-user')).toHaveLength(1)
    expect(container!.querySelector('.ai-queue-strip')).not.toBeNull()
  })

  it('a queued item stays queued while the disclosure is unacknowledged, and sends after the ack (RF4-1)', async () => {
    const panel = await mountThenPreset({ offered: true, acked: true })
    expect(harness.runs).toEqual(['rewrite it'])
    enqueueInComposer(container!, 'queued follow-up')

    // the hint holds the item while the run settles, then a document the user has not
    // acknowledged opens in the panel
    act(() => setAiModelNeedHint('UniWork AI is not on here'))
    act(() => harness.finishRun?.())
    await flush()
    await panel.openDocument('/docs/b.docx')
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

  it('a preset with the disclosure unacknowledged sends nothing, moves focus to the disclosure, and runs after the ack (core4b)', async () => {
    const panel = await mountThenPreset({ offered: true, acked: false })
    act(() => setAiModelNeedHint(null))

    await panel.firePreset(2)
    const region = container!.querySelector<HTMLElement>('[role="region"]')
    expect(region).not.toBeNull()
    expect(harness.runs).toEqual([])
    expect(document.activeElement).toBe(region)

    act(() => {
      region!.querySelector<HTMLButtonElement>('button')!.click()
    })
    await panel.firePreset(3)
    expect(harness.runs).toEqual(['rewrite it'])
  })

  it('a preset that fires while the panel is collapsed to its rail is refused too: the gate does not need the composer mounted (core4b)', async () => {
    const panel = await mountThenPreset({ offered: true, acked: false })
    act(() => setAiModelNeedHint(null))

    await panel.firePreset(2, false)
    expect(container!.querySelector('[role="region"]')).toBeNull()
    expect(harness.runs).toEqual([])
  })

  it('a preset that fires while collapsed expands the panel, then announces the needs-ack line and focuses the disclosure; nothing is sent (RF5-1)', async () => {
    const panel = await mountThenPreset({ offered: true, acked: false })
    act(() => setAiModelNeedHint(null))
    // mounted open, the first preset was refused there: collapse to the rail before the next one
    await panel.firePreset(1, false)
    panel.expand.mockClear()

    await panel.firePreset(2, false)
    expect(panel.expand).toHaveBeenCalledTimes(1)
    expect(harness.runs).toEqual([])

    // the host expands the panel in response: the reason is spoken and the disclosure is focused
    await panel.firePreset(2, true)
    const region = container!.querySelector<HTMLElement>('[role="region"]')
    expect(region).not.toBeNull()
    expect(document.activeElement).toBe(region)
    const spoken = [...container!.querySelectorAll('.ai-uniwork-sr-only')].map((n) => n.textContent)
    // no LocaleProvider here: the panel speaks the default zh
    expect(spoken).toContain(aiUniworkText('zh', 'aiUniworkSendNeedsAck'))
    expect(panel.expand).toHaveBeenCalledTimes(1)
    expect(harness.runs).toEqual([])
  })
})
