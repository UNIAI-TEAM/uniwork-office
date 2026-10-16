// After an AI run changed a never-saved document the panel asks before anything is written (G6-09
// W8): one card under the answer, Save runs the app's first-save flow with the suggested name,
// Not now leaves the document unsaved, a new run replaces an unanswered card, a titled document
// gets no card. The app decides (deps.onRunDone returns the name to offer, or null).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'

interface FakeEvents {
  onToolExecuted?: (e: { call: unknown; execution: unknown; snapshotBefore?: unknown }) => void
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
          call: { id: 'c', name: 'edit_document', input: {} },
          execution: { output: 'ok', mutated: true, summary: 'edit' },
          snapshotBefore: { body: 'before', frontmatter: '' },
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

import { AiPanel, type MarkdownAiDeps } from '../src/renderer/ai/AiPanel'

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('markdown AI panel: ask before saving an untitled document', () => {
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
    harness.mutate = true
    vi.unstubAllGlobals()
  })

  async function mount(offer: string | null) {
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const save = vi.fn(async () => true)
    vi.stubGlobal(
      'markdownApi',
      new Proxy({} as Record<string, unknown>, {
        get(target, prop: string) {
          if (!(prop in target)) {
            target[prop] =
              prop === 'save'
                ? save
                : prop === 'getAiSettings'
                  ? vi.fn(async () => ({ ...usableAiSettings(), provider: 'openai' }))
                  : /^on[A-Z]/.test(prop)
                    ? vi.fn(() => () => {})
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
      content: '<p>Draft</p>',
    })
    const state = { offer }
    const saveWithName = vi.fn()
    const deps = {
      getEditor: () => editor,
      getFrontmatter: () => '',
      setFrontmatter: () => {},
      getSnapshot: () => ({ body: '', frontmatter: '' }),
      restoreSnapshot: () => {},
      onRunDone: vi.fn((mutated: boolean) => (mutated ? state.offer : null)),
      onSaveOffer: saveWithName,
    } as unknown as MarkdownAiDeps
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    let nonce = 0
    const render = (text: string | null) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(AiPanel, {
              deps,
              filePath: null,
              onCollapse: () => {},
              open: true,
              onExpand: () => {},
              ...(text === null ? {} : { preset: { text, nonce: ++nonce } }),
            }),
          ),
        ),
      )
    render(null)
    await flush()
    await flush()
    return {
      deps,
      state,
      save,
      saveWithName,
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

  it('shows one card with the suggested name and writes nothing before the click', async () => {
    const panel = await mount('Quarterly plan')
    await panel.run()
    expect(panel.cards()).toHaveLength(1)
    expect(container!.textContent).toContain('Save this document?')
    expect(container!.textContent).toContain('Save as Quarterly plan')
    expect(panel.saveWithName).not.toHaveBeenCalled()
    expect(panel.save).not.toHaveBeenCalled()
    // the card sits after the assistant's message, in the same transcript
    const transcript = panel.cards()[0]!.parentElement!
    expect(transcript.querySelector('.ai-msg-assistant, .ai-msg')).not.toBeNull()
  })

  it('Save asks the app once to run its first-save flow with that name, and the card goes', async () => {
    const panel = await mount('Quarterly plan')
    await panel.run()
    act(() => panel.button('Save').click())
    expect(panel.saveWithName).toHaveBeenCalledTimes(1)
    expect(panel.saveWithName).toHaveBeenCalledWith('Quarterly plan')
    expect(panel.cards()).toHaveLength(0)
  })

  it('Not now dismisses the card and saves nothing', async () => {
    const panel = await mount('Quarterly plan')
    await panel.run()
    act(() => panel.button('Not now').click())
    expect(panel.cards()).toHaveLength(0)
    expect(panel.saveWithName).not.toHaveBeenCalled()
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

  it('a titled document (no offer) or a run that changed nothing shows no card', async () => {
    const titled = await mount(null)
    await titled.run()
    expect(titled.cards()).toHaveLength(0)
    act(() => root!.unmount())
    container!.remove()
    root = null
    editor!.destroy()
    harness.mutate = false
    const unchanged = await mount('Quarterly plan')
    await unchanged.run()
    expect(unchanged.cards()).toHaveLength(0)
  })

  it('keeps the card out of the way of keyboard users: its buttons are reachable', async () => {
    const panel = await mount('Quarterly plan')
    await panel.run()
    const buttons = [...container!.querySelectorAll<HTMLButtonElement>('.ai-save-draft button')]
    expect(buttons.map((b) => b.textContent)).toEqual(['Save', 'Not now'])
    for (const b of buttons) expect(b.tabIndex).toBeGreaterThanOrEqual(0)
  })
})
