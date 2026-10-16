// One Ctrl/Cmd+Z per AI run reaches the panel (G6-09 W4): undoing a run that saved pictures drops
// them exactly like Roll back (N5) and retires that run's Roll back entry; the redo of such a run
// is refused (its files are gone); a text-only run asks the store for nothing. The loop is a fake
// that fires the real run hooks around the REAL markdown skill tools.
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
  onRunStart?: (runId: string) => void
  onRunEnd?: (runId: string, end: { mutated: boolean; outcome: string }) => void
  onToolStart?: (call: { id: string; name: string; input: unknown }) => void
  onToolExecuted?: (e: { call: unknown; execution: unknown; snapshotBefore?: unknown }) => void
  onDone?: (r: { text: string; cancelled: boolean; turnLimit: boolean; truncated: boolean }) => void
}

const harness = vi.hoisted(() => ({
  /** one script per run: the tool calls the fake model makes */
  scripts: [] as Array<Array<{ name: string; input: Record<string, unknown> }>>,
  runs: 0,
  /** what a script entry named `__user_edit` does: the user types into the editor mid-run */
  userEdit: null as null | (() => void),
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
      const runId = `run-${++harness.runs}`
      this.events?.onRunStart?.(runId)
      this.skill?.buildContext?.()
      const script = harness.scripts.shift() ?? []
      let first = true
      for (const [index, call] of script.entries()) {
        if (call.name === '__user_edit') {
          harness.userEdit?.()
          continue
        }
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
      this.events?.onRunEnd?.(runId, { mutated: !first, outcome: 'done' })
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

describe('markdown AI run undo and the images the run saved', () => {
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
    harness.userEdit = null
    vi.unstubAllGlobals()
  })

  async function mount() {
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    // the fake asset store: every save is a new pending file; discard records what it was asked for
    const store = {
      saved: [] as string[],
      discarded: [] as string[][],
      restored: [] as Array<Array<{ name: string; base64: string }>>,
      /** a restore the main process could not do (file name taken, document moved) */
      restoreFails: false,
    }
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
      restorePendingAssets: vi.fn(async (files: Array<{ name: string; base64: string }>) => {
        if (store.restoreFails) return { restored: [], errors: files.map((f) => f.name) }
        store.restored.push(files.map((f) => ({ ...f })))
        return { restored: files.map((f) => f.name), errors: [] }
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
    harness.userEdit = () => {
      act(() => {
        editor!.commands.setTextSelection(editor!.state.doc.content.size - 1)
        editor!.commands.insertContent('!')
      })
    }
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
  const imageCount = (): number => countImages()
  const countImages = (): number => {
    let n = 0
    editor!.state.doc.descendants((node) => {
      if (node.type.name === 'image') n++
    })
    return n
  }

  it('undoing a run that inserted an image discards that pending asset and retires its Roll back entry', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    expect(imageCount()).toBe(1)
    expect(panel.rollbackButtons()).toHaveLength(1)

    act(() => {
      editor!.commands.undo()
    })
    await flush()

    expect(imageCount()).toBe(0)
    expect(panel.store.discarded).toEqual([['image-1.png']])
    expect(panel.rollbackButtons()).toHaveLength(0)
  })

  it('a second Ctrl+Z does not name the picture again; an earlier run keeps its picture', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    await panel.run([insertImage()])
    expect(imageCount()).toBe(2)
    act(() => {
      editor!.commands.undo()
    })
    await flush()
    expect(imageCount()).toBe(1)
    expect(panel.store.discarded).toEqual([['image-2.png']])
    expect(panel.rollbackButtons()).toHaveLength(1)
  })

  it('redo of a run whose picture was discarded puts the same file back first, then re-applies the run', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    act(() => {
      editor!.commands.undo()
    })
    await flush()
    expect(imageCount()).toBe(0)
    act(() => {
      editor!.commands.redo()
    })
    await flush()
    await flush()
    // the very bytes the run downloaded, under the very name the markup points at
    expect(panel.store.restored).toEqual([[{ name: 'image-1.png', base64: PNG_BASE64 }]])
    expect(imageCount()).toBe(1)
    // the redone run is undoable again and drops the file again
    await undoRun()
    expect(imageCount()).toBe(0)
    expect(panel.store.discarded).toEqual([['image-1.png'], ['image-1.png']])
  })

  it('a redo whose file cannot be restored stays refused: never a broken image link', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    await undoRun()
    panel.store.restoreFails = true
    act(() => {
      editor!.commands.redo()
    })
    await flush()
    await flush()
    expect(imageCount()).toBe(0)
    expect(editor!.getText()).toBe('Saved document')
  })

  // RF3O-2: a refused redo says so, in the panel, instead of doing nothing
  const redoNotice = (): HTMLElement | null =>
    container!.querySelector<HTMLElement>('.ai-redo-refused')

  it('a redo refused because the picture could not be put back tells the user', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    await undoRun()
    expect(redoNotice()).toBeNull()
    panel.store.restoreFails = true
    await redo()
    await flush()
    expect(imageCount()).toBe(0)
    const notice = redoNotice()
    expect(notice).not.toBeNull()
    expect(notice!.getAttribute('role')).toBe('status')
    expect(notice!.textContent).toMatch(/picture/i)
  })

  it('the refusal notice goes when the next run starts', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    await undoRun()
    panel.store.restoreFails = true
    await redo()
    await flush()
    expect(redoNotice()).not.toBeNull()
    await panel.run([])
    expect(redoNotice()).toBeNull()
  })

  it('a redo whose bytes are gone (no restore in this build) tells the user too', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    await undoRun()
    ;(window as any).markdownApi.restorePendingAssets = undefined
    await redo()
    await flush()
    expect(imageCount()).toBe(0)
    expect(redoNotice()).not.toBeNull()
  })

  it('a redo that works shows no notice', async () => {
    const panel = await mount()
    await panel.run([insertImage()])
    await undoRun()
    await redo()
    await flush()
    expect(imageCount()).toBe(1)
    expect(redoNotice()).toBeNull()
  })

  it('a run without pictures: undo and redo leave the store alone', async () => {
    const panel = await mount()
    await panel.run([
      { name: 'apply_ops', input: { ops: [{ op: 'insertContent', after: 0, markdown: 'x' }] } },
    ])
    act(() => {
      editor!.commands.undo()
      editor!.commands.redo()
    })
    await flush()
    expect(panel.store.discarded).toEqual([])
  })

  const userEdit = (): ScriptedCall => ({ name: '__user_edit', input: {} })
  /** after a hand edit the edit guard refuses index-based writes until the model reads the document again */
  const refresh = (): ScriptedCall => ({ name: 'get_document_context', input: {} })
  const insertText = (text: string): ScriptedCall => ({
    name: 'apply_ops',
    input: { ops: [{ op: 'insertContent', after: 0, markdown: text }] },
  })
  const undoRun = async (): Promise<void> => {
    act(() => {
      editor!.commands.undo()
    })
    await flush()
  }
  const undo = async (): Promise<void> => {
    act(() => {
      editor!.commands.undo()
    })
    await flush()
  }
  const redo = async (): Promise<void> => {
    act(() => {
      editor!.commands.redo()
    })
    await flush()
  }

  it('the user typing as the last thing of a run: the first Ctrl+Z is theirs and the picture stays', async () => {
    const panel = await mount()
    await panel.run([insertImage(), userEdit()])
    expect(imageCount()).toBe(1)
    expect(editor!.getText()).toContain('!')

    await undo()
    expect(editor!.getText()).not.toContain('!')
    expect(imageCount()).toBe(1)
    expect(panel.store.discarded).toEqual([])
    expect(panel.rollbackButtons()).toHaveLength(1)

    await undo()
    expect(imageCount()).toBe(0)
    expect(panel.store.discarded).toEqual([['image-1.png']])
    expect(panel.rollbackButtons()).toHaveLength(0)
  })

  it('a picture in the first piece of a split run survives the undo of a later piece', async () => {
    const panel = await mount()
    await panel.run([insertImage(), userEdit(), refresh(), insertText('later')])
    expect(imageCount()).toBe(1)

    await undo() // the later AI piece
    expect(editor!.getText()).not.toContain('later')
    expect(imageCount()).toBe(1)
    expect(panel.store.discarded).toEqual([])
    expect(panel.rollbackButtons()).toHaveLength(1)

    await undo() // the user's keystroke
    expect(imageCount()).toBe(1)
    expect(panel.store.discarded).toEqual([])

    await undo() // the first piece holds the picture: now it goes
    expect(imageCount()).toBe(0)
    expect(panel.store.discarded).toEqual([['image-1.png']])
    expect(panel.rollbackButtons()).toHaveLength(0)
  })

  it('a picture in a later piece: undoing that piece keeps the file for the redo', async () => {
    const panel = await mount()
    await panel.run([insertText('first'), userEdit(), refresh(), insertImage()])
    expect(imageCount()).toBe(1)

    await undo() // the later piece holds the picture, but the run is not undone
    expect(imageCount()).toBe(0)
    expect(panel.store.discarded).toEqual([])
    await redo()
    expect(imageCount()).toBe(1)
    expect(panel.store.discarded).toEqual([])
  })

  it('the AI marker stays after the run ends and goes when the next run starts', async () => {
    const panel = await mount()
    await panel.run([insertText('marked')])
    expect(editor!.view.dom.querySelectorAll('.ai-changed').length).toBeGreaterThan(0)

    // a read-only run: starting it retires the previous run's marker
    await panel.run([])
    expect(editor!.view.dom.querySelectorAll('.ai-changed')).toHaveLength(0)
  })
})
