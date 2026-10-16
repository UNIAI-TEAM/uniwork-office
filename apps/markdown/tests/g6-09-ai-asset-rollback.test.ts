// Roll back of an AI run discards the pending images that run saved beside the document, and only
// those (G6-09 N5): an image the user inserted, or one already saved with the document, is never
// named to the main process. The loop is a fake that runs the REAL markdown skill tools, so the
// image tools' asset bookkeeping is exercised end to end up to the (fake) asset store.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'

interface ScriptedCall {
  name: string
  input: Record<string, unknown>
}
interface FakeEvents {
  onToolStart?: (call: { id: string; name: string; input: unknown }) => void
  onToolExecuted?: (e: { call: unknown; execution: unknown; snapshotBefore?: unknown }) => void
  onDone?: (r: { text: string; cancelled: boolean; turnLimit: boolean; truncated: boolean }) => void
}

const harness = vi.hoisted(() => ({
  /** one script per run: the tool calls the fake model makes */
  scripts: [] as Array<Array<{ name: string; input: Record<string, unknown> }>>,
}))
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    private events: FakeEvents | undefined
    private skill:
      | {
          buildContext?: () => string
          executeTool: (call: unknown, signal?: AbortSignal) => unknown
        }
      | undefined
    constructor(opts?: { events?: FakeEvents; skill?: FakeLoop['skill'] }) {
      this.events = opts?.events
      this.skill = opts?.skill
    }
    async run(): Promise<void> {
      this.busy = true
      this.skill?.buildContext?.()
      const script = harness.scripts.shift() ?? []
      let first = true
      for (const [index, call] of script.entries()) {
        const full = { id: `c${index}`, ...call }
        this.events?.onToolStart?.(full)
        const execution = (await this.skill?.executeTool(full)) as { mutated?: boolean }
        this.events?.onToolExecuted?.({
          call: full,
          execution,
          ...(execution?.mutated && first
            ? { snapshotBefore: { body: 'before', frontmatter: '' } }
            : {}),
        })
        if (execution?.mutated) first = false
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

const PNG_BASE64 = btoa('\x89PNG\r\n\x1a\n-fake-image-bytes')

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('markdown AI Roll back and the images the run saved', () => {
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
    harness.scripts.length = 0
    vi.unstubAllGlobals()
  })

  async function mount() {
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    // the fake asset store: every save is a new pending file; discard records what it was asked for
    const store = { saved: [] as string[], discarded: [] as string[][] }
    const stubs: Record<string, unknown> = {
      fetchImage: vi.fn(async () => ({ base64: PNG_BASE64, mime: 'image/png' })),
      saveImage: vi.fn(async () => {
        const rel = `assets/image-${store.saved.length + 1}.png`
        store.saved.push(rel)
        return rel
      }),
      discardPendingAssets: vi.fn(async (names: string[]) => {
        store.discarded.push([...names])
        return { deleted: names, preserved: [], errors: [] }
      }),
      getAiSettings: vi.fn(async () => ({ ...usableAiSettings(), provider: 'openai' })),
    }
    vi.stubGlobal(
      'markdownApi',
      new Proxy(stubs, {
        get(target, prop: string) {
          if (!(prop in target)) {
            target[prop] = /^on[A-Z]/.test(prop)
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
      content: '<p>Saved document</p>',
    })
    const restored: unknown[] = []
    const deps = {
      getEditor: () => editor,
      getFrontmatter: () => '',
      setFrontmatter: () => {},
      getSnapshot: () => ({ body: '', frontmatter: '' }),
      restoreSnapshot: (snapshot: unknown) => restored.push(snapshot),
      onRunDone: () => {},
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
              filePath: '/docs/a.md',
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
      store,
      restored,
      /** a ribbon preset starts one run with the given scripted tool calls */
      run: async (script: ScriptedCall[]) => {
        harness.scripts.push(script)
        render(`run ${nonce + 1}`)
        await flush()
        await flush()
      },
      rollbackButtons: () => [
        ...container!.querySelectorAll<HTMLButtonElement>('.ai-version-rollback'),
      ],
    }
  }

  const insertImage = (): ScriptedCall => ({
    name: 'insert_image',
    input: { url: 'https://example.test/p.png', alt: 'p' },
  })

  it('rolling back a run that inserted an image discards that pending asset', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    expect(panel.store.saved).toEqual(['assets/image-1.png'])
    expect(panel.rollbackButtons()).toHaveLength(1)

    act(() => panel.rollbackButtons()[0]!.click())
    await flush()

    expect(panel.restored).toHaveLength(1)
    expect(panel.store.discarded).toEqual([['image-1.png']])
  })

  it('names only the AI run assets: an image the user added meanwhile is never discarded', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    // the user pastes a picture after the run: it goes through the same store but not the AI tools
    await window.markdownApi.saveImage({ base64: PNG_BASE64, ext: 'png' })
    expect(panel.store.saved).toEqual(['assets/image-1.png', 'assets/image-2.png'])

    act(() => panel.rollbackButtons()[0]!.click())
    await flush()

    expect(panel.store.discarded).toEqual([['image-1.png']])
  })

  it('a run without images asks the store for nothing', async () => {
    const panel = await mount()
    await panel.run([
      { name: 'edit_document', input: { operations: [{ op: 'insertText', after: 0, text: 'x' }] } },
    ])
    // whatever that tool did to the document, no image was saved
    expect(panel.store.saved).toEqual([])
    for (const button of panel.rollbackButtons()) act(() => button.click())
    await flush()
    expect(panel.store.discarded).toEqual([])
  })

  it('rolling back the latest run keeps the earlier run assets; the earliest takes the later ones too', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    await panel.run([insertImage()])
    expect(panel.rollbackButtons()).toHaveLength(2)

    act(() => panel.rollbackButtons()[1]!.click())
    await flush()
    expect(panel.store.discarded).toEqual([['image-2.png']])

    await panel.run([insertImage()])
    // buttons: run 1, run 3 (run 2 was rolled back); the earliest restores the document to before run 1
    act(() => panel.rollbackButtons()[0]!.click())
    await flush()
    expect(panel.store.discarded.at(-1)?.sort()).toEqual(['image-1.png', 'image-3.png'])
  })
})
