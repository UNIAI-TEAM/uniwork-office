// UniWork AI not offered keeps every send entry closed (spec S7 / RF1-4): the composer already has
// Send off; a ribbon preset, retry or queue run goes through the same panel send() and must not
// start a turn (no bubble, no loop run) while the model-need hint is on. UniWork AI is the one
// provider (UNI-2309), so its disclosure gates every send entry too.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { aiUniworkText, clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'
import { ackUniworkDisclosureInFile } from '../../../packages/ui/tests/helpers/uniwork-ack'

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

describe('markdown panel send entry while UniWork AI cannot send', () => {
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
    // the in-memory empty-account ack must not leak into the next test
    clearUniworkAcks()
    setUniworkAiAvailable(false)
    vi.unstubAllGlobals()
  })

  /** mount with UniWork AI offered or not and its disclosure acknowledged or not, let the chip
   * publish its need, then fire a ribbon preset */
  async function mountThenPreset(opts: { offered: boolean; acked: boolean }) {
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    setUniworkAiAvailable(opts.offered)
    if (opts.acked) ackUniworkDisclosureInFile('/docs/a.md')
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
    let open = true
    let filePath = '/docs/a.md'
    const expand = vi.fn()
    const render = (nonce: number | null) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(AiPanel, {
              deps,
              filePath,
              onCollapse: () => {},
              open,
              onExpand: expand,
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
    return {
      expand,
      /** a fresh ribbon preset (a new nonce); `nextOpen` false fires it while the panel is collapsed */
      firePreset: async (nonce: number, nextOpen = true) => {
        open = nextOpen
        render(nonce)
        await flush()
        await flush()
      },
      /** another document opens in the panel: its disclosure is not acknowledged yet */
      openDocument: async (path: string) => {
        filePath = path
        render(null)
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
    await panel.openDocument('/docs/b.md')
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
    expect(spoken).toContain(aiUniworkText('en', 'aiUniworkSendNeedsAck'))
    expect(panel.expand).toHaveBeenCalledTimes(1)
    expect(harness.runs).toEqual([])
  })
})
