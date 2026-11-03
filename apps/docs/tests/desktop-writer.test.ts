// UNI-2326 (ADR 0052): the desktop reaches the UniWork AI writer route too (R3/R1 in the shell main
// process), so a desktop panel offers write_document, its prompt carries no "not available" note,
// and the one-shot writer goes out on the panel's transport with its writer kind. A real AgentLoop
// over a fake transport; the requests are read off what the transport saw.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import type { AgentStreamCallbacks, AgentStreamRequest } from '@genoffice/agent-core'
import { createDocsEditor, harnessSettings } from './helpers/docs-ai-run-harness'
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
            cb.onDelta('<h1>Plan</h1><p>Written.</p>')
          } else if (requests.filter((r) => !r.purpose).length === 1) {
            cb.onToolCall({
              id: 'call-1',
              name: 'write_document',
              input: { plan: '# Plan', afterBlockIndex: 0 },
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

import { AiPanel } from '../src/renderer/ai/AiPanel'

const pumpUntil = async (cond: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 50 && !cond(); i++) await act(async () => {})
  if (!cond()) throw new Error(`never settled: ${what}`)
}

describe('the desktop docs panel offers and runs write_document (UNI-2326)', () => {
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
    readyUniworkAi('/docs/a.docx')
    // no capabilities object: the desktop
    vi.stubGlobal('desktop', {
      onAiStream: () => () => {},
      aiStream: async () => {},
      aiStreamCancel: async () => {},
      onLanguageChanged: () => () => {},
      getPathForFile: () => '',
    })
    editor = createDocsEditor(['Saved document'])
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(AiPanel, {
          editor: editor!,
          blocks: [],
          settings: harnessSettings,
          open: true,
          filePath: '/docs/a.docx',
        }),
      )
    })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
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
    expect(oneShot.writer?.kind).toBe('docs.write_document')
  })
})
