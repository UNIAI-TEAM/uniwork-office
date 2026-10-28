// UNI-2264: a preset from outside the panel (the desktop shell's, or the job a web host hands over
// with `ai.start`) goes to the loop word for word, since the frame recognises the job's question by
// its text; the bubble shows its display words. One that cannot run now waits in the composer, and a
// remounted panel never runs a preset it already took.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'

const harness = vi.hoisted(() => ({ runs: [] as string[] }))
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    async run(instruction: string): Promise<void> {
      harness.runs.push(instruction)
      this.busy = true
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

const JOB = 'Draft this deck from the job:  Plan\n- Goals'

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

describe('slides AI panel: a preset from outside', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    harness.runs.length = 0
    act(() => setAiModelNeedHint(null))
    clearUniworkAcks()
    setUniworkAiAvailable(false)
    delete (window as { slidesApi?: unknown }).slidesApi
    delete (window as { desktop?: unknown }).desktop
  })

  function mount(provider: AiSettings['provider']) {
    const settings = settingsFor(provider)
    ;(window as { slidesApi?: unknown }).slidesApi = {
      getAiSettings: vi.fn(async () => settings),
      aiGskStatus: vi.fn(async () => ({ loggedIn: false })),
      beginHistoryBatch: vi.fn(async () => false),
      endHistoryBatch: vi.fn(async () => null),
      aiLogRunFailure: vi.fn(async () => undefined),
      onLanguageChanged: () => () => {},
    }
    ;(window as { desktop?: unknown }).desktop = {
      readAttachmentImage: vi.fn(async () => ({ ok: false })),
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const seen = { current: null as number | null }
    return (
      preset: { text: string; nonce: number; autoRun: boolean; displayText?: string } | null,
      key = 1,
    ) =>
      act(() =>
        root!.render(
          createElement(AiPanel, {
            key,
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
            presetSeen: seen,
            ...(preset ? { preset } : {}),
          }),
        ),
      )
  }

  it('runs the text word for word and shows the display words', async () => {
    const render = mount('anthropic')
    render(null)
    await flush()
    await flush()
    render({ text: JOB, nonce: 1, autoRun: true, displayText: 'Draft the deck' })
    await flush()
    await flush()
    expect(harness.runs).toEqual([JOB])
    expect(container!.querySelector('.ai-msg-user')?.textContent).toContain('Draft the deck')
  })

  it('UniWork AI not acknowledged: the text waits in the composer and nothing is sent', async () => {
    setUniworkAiAvailable(true)
    const render = mount('uniwork')
    render(null)
    await flush()
    await flush()
    render({ text: JOB, nonce: 1, autoRun: true })
    await flush()
    await flush()
    expect(harness.runs).toEqual([])
    expect(container!.querySelector('.ai-msg-user')).toBeNull()
    expect(
      container!.querySelector<HTMLTextAreaElement>('textarea[data-slides-ai-input]')!.value,
    ).toBe(JOB)
  })

  it('a panel remounted for another deck key does not run the preset it already took', async () => {
    const render = mount('anthropic')
    render({ text: JOB, nonce: 7, autoRun: true })
    await flush()
    await flush()
    expect(harness.runs).toEqual([JOB])
    render({ text: JOB, nonce: 7, autoRun: true }, 2)
    await flush()
    await flush()
    expect(harness.runs).toEqual([JOB])
  })
})
