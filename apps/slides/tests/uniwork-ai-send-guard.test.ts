// A picked UniWork AI that is not offered keeps every send entry closed (spec S7 / RF1-4 / RF3-3):
// the composer already has Send off; a preset or queued message goes through runWith() and must
// neither start a turn nor drop the queued item while the model-need hint is on.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { setAiModelNeedHint } from '@genoffice/ui'
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

vi.mock('react-konva', () => {
  const stub = () => null
  return Object.fromEntries(
    [
      'Stage',
      'Layer',
      'Rect',
      'Group',
      'Transformer',
      'Line',
      'Arrow',
      'Text',
      'Ellipse',
      'Image',
      'Path',
      'Circle',
      'Arc',
    ].map((k) => [k, stub]),
  )
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
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea[data-slides-ai-input]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

describe('slides panel send entry with an unavailable UniWork AI pick', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    harness.runs.length = 0
    harness.finishRun = null
    act(() => setAiModelNeedHint(null))
    setUniworkAiAvailable(false)
    delete (window as any).slidesApi
    delete (window as any).desktop
  })

  async function mountThenPreset(provider: AiSettings['provider']) {
    const settings = settingsFor(provider)
    ;(window as any).slidesApi = {
      getAiSettings: vi.fn(async () => settings),
      aiGskStatus: vi.fn(async () => ({ loggedIn: false })),
      beginHistoryBatch: vi.fn(async () => false),
      endHistoryBatch: vi.fn(async () => null),
      aiLogRunFailure: vi.fn(async () => undefined),
      onLanguageChanged: () => () => {},
    }
    ;(window as any).desktop = {
      readAttachmentImage: vi.fn(async () => ({ ok: false })),
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (nonce: number | null) =>
      act(() =>
        root!.render(
          createElement(AiPanel, {
            slides: [],
            current: 0,
            selectedIds: [],
            images: new Map(),
            applySlide: () => {},
            applyDeck: () => {},
            fitWidthPx: 960,
            settings,
            open: true,
            onExpand: () => {},
            onCollapse: () => {},
            ...(nonce === null ? {} : { preset: { text: 'rewrite it', autoRun: true, nonce } }),
          }),
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
})
