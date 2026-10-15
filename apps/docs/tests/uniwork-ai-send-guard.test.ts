// A picked UniWork AI that is not offered keeps every send entry closed (spec S7 / RF1-4): the
// composer already has Send off; a ribbon preset, retry, continue or queue run goes through the
// same panel runWith() and must not start a turn (no bubble, no loop run) while the model-need
// hint is on.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { setAiModelNeedHint } from '@genoffice/ui'
import { editorExtensions } from '../src/renderer/editor/extensions'
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

describe('docs panel send entry with an unavailable UniWork AI pick', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy()
    root = null
    container = null
    editor = null
    harness.runs.length = 0
    act(() => setAiModelNeedHint(null))
    setUniworkAiAvailable(false)
  })

  /** mount with `provider` saved, let the picker publish its need, then fire an auto-run preset */
  async function mountThenPreset(provider: AiSettings['provider']) {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'docParagraph',
            attrs: { docxIndex: 0 },
            content: [{ type: 'text', text: 'Saved document' }],
          },
        ],
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const settings = settingsFor(provider)
    const render = (nonce: number | null) =>
      act(() =>
        root!.render(
          createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings,
            open: true,
            ...(nonce === null ? {} : { preset: { text: 'rewrite it', autoRun: true, nonce } }),
          } as never),
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
})
