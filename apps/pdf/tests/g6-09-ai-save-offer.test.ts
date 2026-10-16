// After an AI run changed a shell-created blank PDF the panel asks before anything is written
// (G6-09 W8): one card under the answer, Save hands over to the app's save, Not now leaves the
// edits pending, a new run replaces an unanswered card, a PDF the user opened gets none.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAiSettings } from '@genoffice/ai-provider'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import {
  aiRunSaveOffer,
  nameCandidateFromInserts,
  saveNameFor,
} from '../src/renderer/ai-save-offer'

interface FakeEvents {
  onToolExecuted?: (e: { call: unknown; execution: unknown }) => void
  onDone?: (r: { text: string; cancelled: boolean; turnLimit: boolean; truncated: boolean }) => void
}

const harness = vi.hoisted(() => ({ mutate: true }))
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    private events: FakeEvents | undefined
    constructor(opts?: { events?: FakeEvents }) {
      this.events = opts?.events
    }
    async run(): Promise<void> {
      this.busy = true
      if (harness.mutate) {
        this.events?.onToolExecuted?.({
          call: { id: 'c', name: 'add_text', input: {} },
          execution: { output: 'ok', mutated: true, summary: 'edit' },
        })
      }
      this.busy = false
      this.events?.onDone?.({ text: 'done', cancelled: false, turnLimit: false, truncated: false })
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

describe('pdf AI panel: ask before saving an untitled blank', () => {
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
    harness.mutate = true
    delete (window as any).pdfApi
  })

  async function mount(offer: string | null) {
    Element.prototype.scrollTo = () => {}
    const settings = { ...defaultAiSettings(), uniAiAvailable: false, provider: 'openai' as const }
    settings.providers.openai = { ...settings.providers.openai, apiKey: 'k', model: 'm' }
    const save = vi.fn(async () => ({ ok: true }))
    ;(window as any).pdfApi = {
      getAiSettings: async () => settings,
      onAiSettingsChanged: () => () => {},
      setAiPanelPrefs: () => {},
      gskStatus: async () => ({ loggedIn: false }),
      onLanguageChanged: () => () => {},
      save,
    }
    const api = new Proxy(
      { fileName: () => 'doc.pdf', readOnly: () => false, selection: () => null },
      { get: (t, p: string) => (p in t ? (t as never)[p] : () => null) },
    )
    const state = { offer }
    const onRunDone = vi.fn(async () => state.offer)
    const onSaveOffer = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    let nonce = 0
    const render = (preset: string | null) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(AiPanel, {
              api: api as never,
              filePath: '/docs/Untitled.pdf',
              onCollapse: () => {},
              open: true,
              onExpand: () => {},
              onRunDone,
              onSaveOffer,
              ...(preset === null ? {} : { preset: { text: preset, nonce: ++nonce } }),
            }),
          ),
        ),
      )
    render(null)
    await flush()
    await flush()
    return {
      state,
      save,
      onRunDone,
      onSaveOffer,
      run: async () => {
        render(`run ${nonce + 1}`)
        await flush()
        await flush()
      },
      cards: () => [...container!.querySelectorAll('.ai-save-draft')],
      button: (label: string) =>
        [...container!.querySelectorAll<HTMLButtonElement>('.ai-save-draft button')].find(
          (b) => b.textContent === label,
        )!,
    }
  }

  it('shows one card with the suggested name and saves nothing before the click', async () => {
    const panel = await mount('Quarterly plan')
    await panel.run()
    expect(panel.onRunDone).toHaveBeenCalledTimes(1)
    expect(panel.cards()).toHaveLength(1)
    expect(container!.textContent).toContain('Save this document?')
    expect(container!.textContent).toContain('Save as Quarterly plan')
    expect(panel.onSaveOffer).not.toHaveBeenCalled()
    expect(panel.save).not.toHaveBeenCalled()
  })

  it('Save asks the app once to save, and the card goes', async () => {
    const panel = await mount('Quarterly plan')
    await panel.run()
    act(() => panel.button('Save').click())
    expect(panel.onSaveOffer).toHaveBeenCalledTimes(1)
    expect(panel.onSaveOffer).toHaveBeenCalledWith('Quarterly plan')
    expect(panel.cards()).toHaveLength(0)
  })

  it('Not now dismisses the card and saves nothing', async () => {
    const panel = await mount('Quarterly plan')
    await panel.run()
    act(() => panel.button('Not now').click())
    expect(panel.cards()).toHaveLength(0)
    expect(panel.onSaveOffer).not.toHaveBeenCalled()
    expect(panel.save).not.toHaveBeenCalled()
  })

  it('a new run replaces an unanswered card: never two', async () => {
    const panel = await mount('First name')
    await panel.run()
    panel.state.offer = 'Second name'
    await panel.run()
    expect(panel.cards()).toHaveLength(1)
    expect(container!.textContent).toContain('Save as Second name')
    expect(container!.textContent).not.toContain('First name')
  })

  it('a PDF the user opened (no offer) or a run that changed nothing shows no card', async () => {
    const opened = await mount(null)
    await opened.run()
    expect(opened.cards()).toHaveLength(0)
    act(() => root!.unmount())
    container!.remove()
    root = null
    harness.mutate = false
    const unchanged = await mount('Quarterly plan')
    await unchanged.run()
    expect(unchanged.onRunDone).not.toHaveBeenCalled()
    expect(unchanged.cards()).toHaveLength(0)
  })

  it('its buttons are plain keyboard-reachable buttons', async () => {
    const panel = await mount('Quarterly plan')
    await panel.run()
    const buttons = [...container!.querySelectorAll<HTMLButtonElement>('.ai-save-draft button')]
    expect(buttons.map((b) => b.textContent)).toEqual(['Save', 'Not now'])
    for (const b of buttons) expect(b.tabIndex).toBeGreaterThanOrEqual(0)
  })
})

describe('aiRunSaveOffer (the app side: which documents get the card)', () => {
  const untitled = async () => true
  it('offers the name for a shell-created blank the user has not named', async () => {
    await expect(
      aiRunSaveOffer({
        filePath: '/d/Untitled.pdf',
        readOnly: false,
        isUntitled: untitled,
        name: 'Plan',
      }),
    ).resolves.toBe('Plan')
  })
  it('offers an empty name when nothing could be derived (the card leaves the file line out)', async () => {
    await expect(
      aiRunSaveOffer({
        filePath: '/d/Untitled.pdf',
        readOnly: false,
        isUntitled: untitled,
        name: '',
      }),
    ).resolves.toBe('')
  })
  it('offers nothing for a PDF the user opened, a view-only one, no path, or a failed check', async () => {
    const opened = async () => false
    const failing = async () => {
      throw new Error('ipc')
    }
    await expect(
      aiRunSaveOffer({ filePath: '/d/a.pdf', readOnly: false, isUntitled: opened, name: 'Plan' }),
    ).resolves.toBeNull()
    await expect(
      aiRunSaveOffer({
        filePath: '/d/Untitled.pdf',
        readOnly: true,
        isUntitled: untitled,
        name: 'Plan',
      }),
    ).resolves.toBeNull()
    await expect(
      aiRunSaveOffer({ filePath: undefined, readOnly: false, isUntitled: untitled, name: 'Plan' }),
    ).resolves.toBeNull()
    await expect(
      aiRunSaveOffer({
        filePath: '/d/Untitled.pdf',
        readOnly: false,
        isUntitled: failing,
        name: 'Plan',
      }),
    ).resolves.toBeNull()
  })
})

describe('nameCandidateFromInserts', () => {
  const insert = (pageIndex: number, y: number, text: string) => ({
    input: { pageIndex, origin: [0, y], text },
  })
  it('takes the first line of the topmost text on the first page', () => {
    expect(
      nameCandidateFromInserts([
        insert(1, 700, 'Second page'),
        insert(0, 100, 'Footer'),
        insert(0, 700, '  Quarterly plan  \nsecond line'),
      ] as never),
    ).toBe('Quarterly plan')
  })
  it('is empty when nothing was inserted', () => {
    expect(nameCandidateFromInserts([])).toBe('')
  })
})

describe('saveNameFor (RFB-4: the card and the saved name agree)', () => {
  const inserts = [{ input: { pageIndex: 0, origin: [10, 700], text: 'Changed later' } }]
  it('keeps the name the card offered even when the inserts changed after the card', () => {
    expect(saveNameFor('Quarterly plan', inserts)).toBe('Quarterly plan')
  })
  it('falls back to the inserted text when no name was offered', () => {
    expect(saveNameFor(null, inserts)).toBe('Changed later')
    expect(saveNameFor('', inserts)).toBe('Changed later')
  })
})
