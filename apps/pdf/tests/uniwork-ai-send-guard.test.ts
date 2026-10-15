// A picked UniWork AI that is not offered keeps every send entry closed (spec S7 / RF1-4): the
// composer already has Send off; a ribbon preset, retry or queue run goes through the same panel
// send() and must not start a turn (no bubble, no loop run) while the model-need hint is on.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { aiUniworkText, clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { LocaleProvider } from '../src/renderer/i18n/locale'
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

describe('pdf panel send entry with an unavailable UniWork AI pick', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    harness.runs.length = 0
    harness.finishRun = null
    act(() => setAiModelNeedHint(null))
    // the in-memory empty-account ack must not leak into the next test
    clearUniworkAcks()
    setUniworkAiAvailable(false)
    delete (window as any).pdfApi
  })

  /** mount with `provider` saved, let the picker publish its need, then fire a ribbon preset */
  async function mountThenPreset(provider: 'uniwork' | 'openai') {
    Element.prototype.scrollTo = () => {}
    const settings = {
      ...defaultAiSettings(),
      uniAiAvailable: false,
      provider,
    }
    settings.providers.openai = {
      ...settings.providers.openai,
      apiKey: 'test-key',
      model: 'gpt-test',
    }
    const changed: Array<() => void> = []
    ;(window as any).pdfApi = {
      getAiSettings: async () => settings,
      onAiSettingsChanged: (handler: () => void) => {
        changed.push(handler)
        return () => {}
      },
      setAiPanelPrefs: () => {},
      gskStatus: async () => ({ loggedIn: false }),
      onLanguageChanged: () => () => {},
    }
    const api = new Proxy(
      { fileName: () => 'doc.pdf', readOnly: () => false, selection: () => null },
      { get: (t, p: string) => (p in t ? (t as never)[p] : () => null) },
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    let open = true
    const expand = vi.fn()
    const render = (nonce: number | null) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(AiPanel, {
              api: api as never,
              filePath: '/docs/a.pdf',
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
      /** the user picks `next` in the model picker: the saved settings change and the panel is told */
      pick: async (next: 'uniwork' | 'openai') => {
        settings.provider = next
        act(() => changed.forEach((handler) => handler()))
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

  it('a queued item stays queued while UniWork AI is picked with an unacknowledged disclosure, and sends after the ack (RF4-1)', async () => {
    const panel = await mountThenPreset('openai')
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
    const panel = await mountThenPreset('openai')
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

  it('a preset that fires while collapsed expands the panel, then announces the needs-ack line and focuses the disclosure; nothing is sent (RF5-1)', async () => {
    const panel = await mountThenPreset('openai')
    act(() => harness.finishRun?.())
    await flush()
    setUniworkAiAvailable(true)
    await panel.pick('uniwork')
    act(() => setAiModelNeedHint(null))

    await panel.firePreset(2, false)
    expect(panel.expand).toHaveBeenCalledTimes(1)
    expect(harness.runs).toEqual(['rewrite it'])

    // the host expands the panel in response: the reason is spoken and the disclosure is focused
    await panel.firePreset(2, true)
    const region = container!.querySelector<HTMLElement>('[role="region"]')
    expect(region).not.toBeNull()
    expect(document.activeElement).toBe(region)
    const spoken = [...container!.querySelectorAll('.ai-uniwork-sr-only')].map((n) => n.textContent)
    expect(spoken).toContain(aiUniworkText('en', 'aiUniworkSendNeedsAck'))
    expect(panel.expand).toHaveBeenCalledTimes(1)
    expect(harness.runs).toEqual(['rewrite it'])
  })
})
