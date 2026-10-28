// UNI-2264: a preset from outside the panel (a ribbon button, or the job a web host hands over with
// `ai.start`) goes to the loop word for word, since the frame recognises the job's question by its
// text; the bubble shows its display words and the bubble's Retry sends the text again. One that
// cannot run now waits in the composer.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'

const harness = vi.hoisted(() => ({
  runs: [] as string[],
  fail: null as ((error: string) => void) | null,
}))
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    private events: { onError?: (error: string, key?: string) => void } | undefined
    constructor(opts?: { events?: FakeLoop['events'] }) {
      this.events = opts?.events
    }
    async run(instruction: string): Promise<void> {
      harness.runs.push(instruction)
      this.busy = true
      harness.fail = (error) => {
        this.busy = false
        this.events?.onError?.(error)
      }
    }
    cancel(): void {}
    reset(): void {}
    restore(): void {}
  }
  return { ...real, AgentLoop: FakeLoop }
})

import { AiPanel, type AiPreset, type MarkdownAiDeps } from '../src/renderer/ai/AiPanel'

const JOB = 'Draft this note from the job:  Plan\n- Goals'

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('markdown AI panel: a preset from outside', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo = () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy()
    root = null
    container = null
    editor = null
    harness.runs.length = 0
    harness.fail = null
    act(() => setAiModelNeedHint(null))
    clearUniworkAcks()
    setUniworkAiAvailable(false)
    vi.unstubAllGlobals()
  })

  function mount(provider: 'uniwork' | 'openai') {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
    vi.stubGlobal(
      'markdownApi',
      new Proxy(stubs, {
        get(target, prop: string) {
          if (!(prop in target)) {
            target[prop] = /^on[A-Z]/.test(prop)
              ? vi.fn(() => () => {})
              : prop === 'getAiSettings'
                ? vi.fn(async () => ({ ...usableAiSettings(), provider }))
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
    const deps = {
      getEditor: () => editor,
      getFrontmatter: () => '',
      setFrontmatter: () => {},
      getSnapshot: () => ({}),
      restoreSnapshot: () => {},
      onRunDone: () => null,
    } as unknown as MarkdownAiDeps
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    return (preset: AiPreset | null) =>
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
              preset,
            }),
          ),
        ),
      )
  }

  it('runs the text word for word, shows the display words, and the bubble Retry sends the text again', async () => {
    const render = mount('openai')
    render(null)
    await flush()
    await flush()
    render({ text: JOB, nonce: 1, autoRun: true, displayText: 'Draft the note' })
    await flush()
    await flush()
    expect(harness.runs).toEqual([JOB])
    expect(container!.querySelector('.ai-msg-user')?.textContent).toContain('Draft the note')

    act(() => harness.fail!('network down'))
    await flush()
    const retry = container!.querySelector<HTMLButtonElement>('.ai-msg-undelivered .ai-retry-btn')!
    act(() => retry.click())
    await flush()
    await flush()
    expect(harness.runs).toEqual([JOB, JOB])
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
    expect(container!.querySelector<HTMLTextAreaElement>('textarea.ai-input')!.value).toBe(JOB)
  })

  it('a job the host handed over that may not auto-run waits in the composer', async () => {
    const render = mount('openai')
    render(null)
    await flush()
    await flush()
    render({ text: JOB, nonce: 1, autoRun: false })
    await flush()
    expect(harness.runs).toEqual([])
    expect(container!.querySelector<HTMLTextAreaElement>('textarea.ai-input')!.value).toBe(JOB)
  })

  it('a host job on another provider than UniWork AI when it would run waits in the focused composer', async () => {
    const render = mount('openai')
    render(null)
    await flush()
    await flush()
    render({ text: JOB, nonce: 1, autoRun: true, uniworkOnly: true })
    await flush()
    await flush()
    expect(harness.runs).toEqual([])
    const box = container!.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
    expect(box.value).toBe(JOB)
    expect(document.activeElement).toBe(box)
  })
})
