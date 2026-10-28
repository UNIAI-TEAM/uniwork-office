// UNI-2264: a preset from outside the panel (a ribbon button, or the job a web host hands over with
// `ai.start`) goes to the loop word for word, since the frame recognises the job's question by its
// text; the bubble shows its display words and Retry sends the text again. One that cannot run now
// waits in the composer; a preset seen again (its nonce) never runs twice.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAiSettings, setUniworkAiAvailable } from '@genoffice/ai-provider'
import { clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { LocaleProvider } from '../src/renderer/i18n/locale'

const harness = vi.hoisted(() => ({
  runs: [] as string[],
  fail: null as ((error: string, key?: string) => void) | null,
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
      harness.fail = (error, key) => {
        this.busy = false
        this.events?.onError?.(error, key)
      }
    }
    cancel(): void {}
    reset(): void {}
    restore(): void {}
  }
  return { ...real, AgentLoop: FakeLoop }
})

import { AiPanel } from '../src/renderer/ai/AiPanel'

const JOB = 'Summarise this PDF for the job:  Plan\n- Goals'

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('pdf AI panel: a preset from outside', () => {
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
    harness.fail = null
    act(() => setAiModelNeedHint(null))
    clearUniworkAcks()
    setUniworkAiAvailable(false)
    delete (window as { pdfApi?: unknown }).pdfApi
  })

  function mount(provider: 'uniwork' | 'openai') {
    const settings = { ...defaultAiSettings(), uniAiAvailable: false, provider }
    settings.providers.openai = {
      ...settings.providers.openai,
      apiKey: 'test-key',
      model: 'gpt-test',
    }
    ;(window as { pdfApi?: unknown }).pdfApi = {
      getAiSettings: async () => settings,
      onAiSettingsChanged: () => () => {},
      setAiPanelPrefs: () => {},
      gskStatus: async () => ({ loggedIn: false }),
      onLanguageChanged: () => () => {},
    }
    const api = new Proxy(
      { fileName: () => 'doc.pdf', readOnly: () => false, selection: () => null },
      { get: (t, p: string) => (p in t ? (t as never)[p] : () => null) },
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    return (
      preset: { text: string; nonce: number; displayText?: string; uniworkOnly?: boolean } | null,
    ) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(AiPanel, {
              api: api as never,
              filePath: '/docs/a.pdf',
              onCollapse: () => {},
              open: true,
              onExpand: () => {},
              preset,
            }),
          ),
        ),
      )
  }

  it('runs the text word for word, shows the display words, and Retry sends the text again', async () => {
    const render = mount('openai')
    render(null)
    await flush()
    await flush()
    render({ text: JOB, nonce: 1, displayText: 'Summarise it' })
    await flush()
    await flush()
    expect(harness.runs).toEqual([JOB])
    expect(container!.querySelector('.ai-msg-user')?.textContent).toContain('Summarise it')

    // the same preset again (the dock re-rendering it) never runs twice
    render(null)
    render({ text: JOB, nonce: 1, displayText: 'Summarise it' })
    await flush()
    expect(harness.runs).toEqual([JOB])

    // both Retry entries send the text again: the "not sent" bubble's (another provider's failure)
    // and the error answer's own (a UniWork AI error)
    act(() => harness.fail!('network down'))
    await flush()
    act(() =>
      container!.querySelector<HTMLButtonElement>('.ai-msg-undelivered .ai-retry-btn')!.click(),
    )
    await flush()
    await flush()
    // the turn now runs on UniWork AI (the S9 action reads the provider when the window takes focus)
    setUniworkAiAvailable(true)
    ;(window as unknown as { pdfApi: { getAiSettings: unknown } }).pdfApi.getAiSettings =
      async () => ({ ...defaultAiSettings(), provider: 'uniwork' })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    act(() => harness.fail!('UniWork AI is not available right now.', 'aiErrUnavailable'))
    await flush()
    const ack = container!.querySelector<HTMLButtonElement>('.ai-uniwork-disclosure-ack')
    if (ack) act(() => ack.click())
    await flush()
    act(() =>
      container!
        .querySelector<HTMLButtonElement>('.ai-error-action button[data-action="retry"]')!
        .click(),
    )
    await flush()
    await flush()
    expect(harness.runs).toEqual([JOB, JOB, JOB])
    expect(
      [...container!.querySelectorAll('.ai-msg-user')].map((n) => n.textContent).at(-1),
    ).toContain('Summarise it')
  })

  it('UniWork AI not acknowledged: the text waits in the composer and nothing is sent', async () => {
    setUniworkAiAvailable(true)
    const render = mount('uniwork')
    render(null)
    await flush()
    await flush()
    render({ text: JOB, nonce: 1 })
    await flush()
    await flush()
    expect(harness.runs).toEqual([])
    expect(container!.querySelector('.ai-msg-user')).toBeNull()
    expect(container!.querySelector<HTMLTextAreaElement>('textarea.ai-input')!.value).toBe(JOB)
  })

  it('a host job on another provider than UniWork AI when it would run waits in the focused composer', async () => {
    const render = mount('openai')
    render(null)
    await flush()
    await flush()
    render({ text: JOB, nonce: 1, uniworkOnly: true })
    await flush()
    await flush()
    expect(harness.runs).toEqual([])
    const box = container!.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
    expect(box.value).toBe(JOB)
    expect(document.activeElement).toBe(box)
  })
})

// The PDF App cannot be mounted in jsdom (the pdf.js worker URL import), so its gate is pinned from
// source: the panel gets a preset only once the document is ready, and its nonce guard (above) runs
// it once however often the gate closes and opens again (a reload after a save)
describe('pdf App: the preset waits for the document', () => {
  it('hands the panel its preset only while the document is ready', () => {
    const app = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/App.tsx'),
      'utf8',
    )
    expect(app).toContain("preset={status === 'ready' ? aiPreset : null}")
    expect(app.match(/preset=\{/g)).toHaveLength(1)
  })
})
