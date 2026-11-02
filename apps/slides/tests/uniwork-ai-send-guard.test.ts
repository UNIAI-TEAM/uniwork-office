// UniWork AI not offered keeps every send entry closed (spec S7 / RF1-4 / RF3-3): the composer
// already has Send off; a preset or queued message goes through runWith() and must neither start a
// turn nor drop the queued item while the model-need hint is on. UniWork AI is the one provider
// (UNI-2309), so its disclosure and composer note gate every send entry too.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { ack, aiUniworkText, clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'
import { ackUniworkDisclosure } from '../../../packages/ui/tests/helpers/uniwork-ack'

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

const settings: AiSettings = {
  provider: 'uniwork',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: '', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

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

describe('slides panel send entry while UniWork AI cannot send', () => {
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
    // the in-memory empty-account ack must not leak into the next test
    clearUniworkAcks()
    setUniworkAiAvailable(false)
    delete (window as any).slidesApi
    delete (window as any).desktop
    delete (window as any).uniworkCloudStatus
  })

  /** mount with UniWork AI offered or not and its disclosure acknowledged or not (an ack of an
   * account goes through `ack` before the mount), then fire a preset */
  async function mountThenPreset(opts: { offered: boolean; acked: boolean }) {
    setUniworkAiAvailable(opts.offered)
    if (opts.acked) ackUniworkDisclosure('local')
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
    const view = { open: true, expand: vi.fn(), path: null as string | null }
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
            currentFilePath: view.path,
            open: view.open,
            onExpand: view.expand,
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
    return {
      expand: view.expand,
      /** another deck opens in the panel: its disclosure is not acknowledged yet */
      openDocument: async (path: string) => {
        view.path = path
        render(1)
        await flush()
      },
      /** a fresh preset (a new nonce); `nextOpen` false fires it while the panel is collapsed */
      firePreset: async (nonce: number, nextOpen = true) => {
        view.open = nextOpen
        render(nonce)
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

    // the hint holds the item while the run settles, then a deck the user has not acknowledged
    // opens in the panel
    act(() => setAiModelNeedHint('UniWork AI is not on here'))
    act(() => harness.finishRun?.())
    await flush()
    await panel.openDocument('/tmp/other.pptx')
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
    // mounted open, the first preset was refused there: collapse before the next one
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
    const spoken = [...container!.querySelectorAll('[aria-live="polite"]')].map(
      (n) => n.textContent,
    )
    // no LocaleProvider here: the panel speaks the default zh
    expect(spoken).toContain(aiUniworkText('zh', 'aiUniworkSendNeedsAck'))
    expect(panel.expand).toHaveBeenCalledTimes(1)
    expect(harness.runs).toEqual([])
  })

  it('a queued item also waits for a UniWork composer note, as Send does, and sends once it clears (core4b)', async () => {
    const snapshot = (state: string) => ({
      state,
      signedIn: state !== 'signed-out',
      accountId: 'acc-1',
      orgId: 'org-1',
      orgName: 'Acme',
    })
    let push: ((snap: unknown) => void) | null = null
    ;(window as any).uniworkCloudStatus = {
      get: vi.fn(async () => snapshot('ready')),
      onChange: (handler: (snap: unknown) => void) => {
        push = handler
        return () => {}
      },
      signIn: vi.fn(),
    }
    // the disclosure is acknowledged: only the composer note stands in the way
    ack({ account: 'acc-1', org: 'org-1', document: 'local' })

    await mountThenPreset({ offered: true, acked: false })
    expect(harness.runs).toEqual(['rewrite it'])
    enqueueInComposer(container!, 'queued follow-up')

    // the account signs out while the run settles: the note holds the item
    act(() => push?.(snapshot('signed-out')))
    act(() => harness.finishRun?.())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900))
    })

    expect(container!.querySelector('[role="region"]')).toBeNull()
    expect(harness.runs).toEqual(['rewrite it'])
    expect(container!.querySelector('.ai-queue-strip')).not.toBeNull()

    act(() => push?.(snapshot('ready')))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900))
    })
    expect(harness.runs).toEqual(['rewrite it', 'queued follow-up'])
  })
})
