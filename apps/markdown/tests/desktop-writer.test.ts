// UNI-2326 (ADR 0052): the desktop reaches the UniWork AI writer route too (R3/R1 in the shell main
// process), so a desktop panel offers write_document, its prompt carries no "not available" note,
// and the one-shot writer goes out on the panel's transport with its writer kind. A real AgentLoop
// over a fake transport; the requests are read off what the transport saw.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import type { AgentStreamCallbacks, AgentStreamRequest } from '@genoffice/agent-core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'
import { readyUniworkAi, resetUniworkAi } from '../../../packages/ui/tests/helpers/uniwork-ack'

const harness = vi.hoisted(() => {
  const requests: AgentStreamRequest[] = []
  return {
    requests,
    transport: {
      stream(request: AgentStreamRequest, cb: AgentStreamCallbacks) {
        requests.push(request)
        queueMicrotask(() => {
          if (request.purpose === 'one-shot') {
            cb.onDelta('# Plan\n\nWritten.')
          } else if (requests.filter((r) => !r.purpose).length === 1) {
            cb.onToolCall({
              id: 'call-1',
              name: 'write_document',
              input: { plan: '# Plan', afterIndex: 0 },
            })
          } else {
            cb.onDelta('done')
          }
          cb.onDone()
        })
        return { cancel() {} }
      },
    },
  }
})

vi.mock('../src/renderer/ai/transport', () => ({
  createElectronTransport: () => harness.transport,
}))

import { AiPanel, type MarkdownAiDeps } from '../src/renderer/ai/AiPanel'

const pumpUntil = async (cond: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 50 && !cond(); i++) await act(async () => {})
  if (!cond()) throw new Error(`never settled: ${what}`)
}

describe('the desktop markdown panel offers and runs write_document (UNI-2326)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy()
    root = container = editor = null
    harness.requests.length = 0
    resetUniworkAi()
    vi.unstubAllGlobals()
  })

  it('offers it, says nothing about it being unavailable, and sends its one-shot writer', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    readyUniworkAi('/docs/a.md')
    // no capabilities object: the desktop
    const stubs: Record<string, unknown> = { getAiSettings: vi.fn(async () => usableAiSettings()) }
    vi.stubGlobal(
      'markdownApi',
      new Proxy(stubs, {
        get(target, prop: string) {
          if (!(prop in target))
            target[prop] = /^on[A-Z]/.test(prop)
              ? vi.fn(() => () => {})
              : vi.fn(async () => undefined)
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
    const deps: MarkdownAiDeps = {
      getEditor: () => editor,
      getFrontmatter: () => '',
      setFrontmatter: () => {},
      getSnapshot: () => ({ body: 'Saved document', frontmatter: '' }),
      restoreSnapshot: () => {},
      onRunDone: () => null,
      onSaveOffer: () => {},
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(AiPanel, { deps, filePath: '/docs/a.md', onCollapse: () => {} }),
        ),
      )
    })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(textarea, 'write a short memo')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await pumpUntil(() => harness.requests.some((r) => r.purpose === 'one-shot'), 'the writer')
    const turn = harness.requests[0]!
    expect(turn.tools.map((t) => t.name)).toContain('write_document')
    expect(turn.system).not.toContain('write_document is not available here')
    const oneShot = harness.requests.find((r) => r.purpose === 'one-shot')!
    expect(oneShot.writer?.kind).toBe('markdown.write_document')
  })
})
