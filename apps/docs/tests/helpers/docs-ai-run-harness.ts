// Mounts the docs AiPanel over a real editor with a scripted IPC stream, so a test can play one
// AI run turn by turn (tool calls, text, done) and then look at the document, its undo history
// and the panel. Shared by the G6-09 docs tests (marker, undo per run, Roll back, ask-first save).
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../../src/renderer/editor/extensions'
import { AiPanel } from '../../src/renderer/ai/AiPanel'
import type { Lang } from '@genoffice/i18n'
import { LocaleProvider } from '../../src/renderer/i18n/locale'
import { AI_PROVIDERS, type AiSettings } from '../../src/shared/ipc'

type AiPanelProps = Parameters<typeof AiPanel>[0]

export const harnessSettings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: 'k', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

export const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

export const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await flush()
}

/** a document of plain paragraphs, one per text */
export function createDocsEditor(texts: string[]): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: texts.map((text, i) => ({
        type: 'docParagraph',
        attrs: { docxIndex: i },
        content: [{ type: 'text', text }],
      })),
    },
  })
}

export interface DocsAiHarness {
  editor: Editor
  container: HTMLElement
  /** number of model turns the panel has requested so far */
  turns(): number
  /** play a model turn that calls these tools and ends (the loop runs them, then asks for the next turn) */
  toolTurn(calls: Array<{ name: string; input: Record<string, unknown> }>): Promise<void>
  /** play a final text turn: the run ends */
  textTurn(text: string): Promise<void>
  /** play a turn that fails: the run ends with this error */
  errorTurn(message: string): Promise<void>
  /** send a message from the composer: the run starts */
  send(text: string): Promise<void>
  /** the Stop button of the composer */
  stop(): Promise<void>
  cleanup(): void
}

let callSeq = 0

/** mount the panel; `extra` props go straight to AiPanel */
export async function mountDocsAiPanel(
  texts: string[],
  extra: { filePath?: string | null; lang?: Lang } & Partial<
    Pick<
      AiPanelProps,
      'sideState' | 'commentsAccess' | 'hfAccess' | 'pageSetupAccess' | 'docExtras'
    >
  > = {},
): Promise<DocsAiHarness> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollTo ??= () => {}
  let listener: ((chunk: unknown) => void) | undefined
  const requests: string[] = []
  const win = window as unknown as Record<string, unknown>
  win.desktop = {
    onAiStream: (l: (chunk: unknown) => void) => {
      listener = l
      return () => {
        listener = undefined
      }
    },
    aiStream: async (request: { requestId: string }) => {
      requests.push(request.requestId)
    },
    aiStreamCancel: async () => {},
    onLanguageChanged: () => () => {},
    getPathForFile: () => '',
  }
  const editor = createDocsEditor(texts)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const { lang, ...panelExtra } = extra
  const element = (): ReactElement => {
    const panel = createElement(AiPanel, {
      editor,
      blocks: [],
      settings: harnessSettings,
      open: true,
      ...panelExtra,
      filePath: extra.filePath === undefined ? '/docs/a.docx' : extra.filePath,
    })
    return lang ? createElement(LocaleProvider, { initial: lang }, panel) : panel
  }
  act(() => root.render(element()))
  await settle()
  const emit = async (chunk: Record<string, unknown>) => {
    const requestId = requests.at(-1)
    await act(async () => {
      listener?.({ requestId, ...chunk })
    })
  }
  return {
    editor,
    container,
    turns: () => requests.length,
    async toolTurn(calls) {
      for (const c of calls) {
        await emit({
          type: 'tool-call',
          toolCall: { id: `call-${++callSeq}`, name: c.name, input: c.input },
        })
      }
      await emit({ type: 'done' })
      await settle()
    },
    async textTurn(text) {
      await emit({ type: 'delta', text })
      await emit({ type: 'done' })
      await settle()
    },
    async errorTurn(message) {
      await emit({ type: 'error', error: message })
      await settle()
    },
    async send(text) {
      const input = container.querySelector<HTMLTextAreaElement>('textarea')
      if (!input) throw new Error('composer input not found')
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
        setter.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      await settle()
    },
    async stop() {
      const before = requests.length
      const btn = container.querySelector<HTMLButtonElement>('button.ai-stop-btn')
      if (!btn) throw new Error('stop button not found')
      await act(async () => btn.click())
      // the transport's cancel ends the stream like a done chunk
      if (requests.length === before) await emit({ type: 'done' })
      await settle()
    },
    cleanup() {
      act(() => root.unmount())
      container.remove()
      editor.destroy()
      delete win.desktop
    },
  }
}

/** indexes of the top-level blocks that carry the AI change marker */
export function markedBlocks(editor: Editor): number[] {
  const out: number[] = []
  editor.state.doc.forEach((node, _offset, index) => {
    if (node.attrs.aiChanged) out.push(index)
  })
  return out
}
