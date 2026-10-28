// UNI-2264: a preset from outside the panel (a ribbon button, or the job a web host hands over with
// `ai.start`) goes to the loop word for word, since the frame recognises the job's question by its
// text; the bubble shows its display words. One that cannot run now waits in the composer as is (an
// element ask keeps the words the user typed there).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'

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

import { AiPanel, type AiPreset, type HtmlAiDeps } from '../src/renderer/ai/AiPanel'

const JOB = 'Draft this page from the job:  Plan\n- Goals'

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('html AI panel: a preset from outside', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo = () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    harness.runs.length = 0
    act(() => setAiModelNeedHint(null))
    clearUniworkAcks()
    setUniworkAiAvailable(false)
    vi.unstubAllGlobals()
  })

  function mount(provider: 'uniwork' | 'openai') {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
    vi.stubGlobal(
      'htmlApi',
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
    const text = '<!doctype html>\n<html><body><h1>Quarterly</h1></body></html>'
    const deps = {
      access: {
        getText: () => text,
        getVersion: () => 1,
        getMap: () => buildParseMap(text, 1, null),
        getLastManualVersion: () => 0,
        getFilePath: () => '/tmp/page.html',
        getSelectedSid: () => null,
        applyOps: () => ({ ok: true, ranges: [] }),
        replaceAll: () => {},
      },
      getSnapshot: () => ({}),
      restoreSnapshot: () => {},
      onRunDone: () => {},
      clearHighlights: () => {},
      navigateTo: () => {},
      onBriefConfirmed: () => {},
      previewDraft: () => {},
    } as unknown as HtmlAiDeps
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
              filePath: '/tmp/page.html',
              editQueue: [],
              onQueueEditInstruction: () => {},
              onQueueRemove: () => {},
              onQueueClear: () => {},
              onQueueFocus: () => {},
              onQueueConsume: () => {},
              onCollapse: () => {},
              open: true,
              onExpand: () => {},
              preset,
            }),
          ),
        ),
      )
  }

  it('runs the text word for word and shows the display words', async () => {
    const render = mount('openai')
    render(null)
    await flush()
    await flush()
    render({ text: JOB, nonce: 1, autoRun: true, displayText: 'Draft the page' })
    await flush()
    await flush()
    expect(harness.runs).toEqual([JOB])
    expect(container!.querySelector('.ai-msg-user')?.textContent).toContain('Draft the page')
  })

  it('UniWork AI not acknowledged: the text waits in the composer and nothing is sent', async () => {
    setUniworkAiAvailable(true)
    const render = mount('uniwork')
    render(null)
    await flush()
    await flush()
    render({ text: JOB, nonce: 1, autoRun: true, displayText: 'Draft the page' })
    await flush()
    await flush()
    expect(harness.runs).toEqual([])
    expect(container!.querySelector('.ai-msg-user')).toBeNull()
    // a host job waits as its text, never its display words: sent as is, it still runs the job
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
