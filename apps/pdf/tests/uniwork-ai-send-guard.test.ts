// A picked UniWork AI that is not offered keeps every send entry closed (spec S7 / RF1-4): the
// composer already has Send off; a ribbon preset, retry or queue run goes through the same panel
// send() and must not start a turn (no bubble, no loop run) while the model-need hint is on.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { setAiModelNeedHint } from '@genoffice/ui'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { defaultAiSettings } from '@genoffice/ai-provider'

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

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('pdf panel send entry with an unavailable UniWork AI pick', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    harness.runs.length = 0
    act(() => setAiModelNeedHint(null))
    setUniworkAiAvailable(false)
    delete (window as any).pdfApi
  })

  /** mount with `provider` saved, let the picker publish its need, then fire a ribbon preset */
  async function mountThenPreset(provider: 'uniwork' | 'openai') {
    Element.prototype.scrollTo = () => {}
    const settings = {
      ...defaultAiSettings(),
      uniAiAvailable: false,
      provider,
    }
    settings.providers.openai = {
      ...settings.providers.openai,
      apiKey: 'test-key',
      model: 'gpt-test',
    }
    ;(window as any).pdfApi = {
      getAiSettings: async () => settings,
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
    const render = (nonce: number | null) =>
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
              ...(nonce === null ? {} : { preset: { text: 'rewrite it', nonce } }),
            }),
          ),
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
    await mountThenPreset('openai')
    expect(harness.runs).toHaveLength(1)
    expect(container!.querySelector('.ai-msg-user')).not.toBeNull()
  })
})
