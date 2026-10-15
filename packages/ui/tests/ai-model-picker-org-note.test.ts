/** @vitest-environment jsdom */
// G6-05k fx-ui: the first-use note of a provider served by a key on UniWork is shown once per
// provider and stays quiet afterwards (also after a remount), its options carry the org origin in
// their accessible description, and the chip reads the org model from modelSources.
// (A .ts file: this package's vitest include only matches tests/**/*.test.ts.)
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'
import { AiModelPicker, type AiModelPickerBridge } from '../src/AiModelPicker'
import { AI_MODEL_PICKER_STRINGS } from '../src/strings-ai-model-picker'

const en = AI_MODEL_PICKER_STRINGS.en

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

function orgSettings(local?: { model?: string }): AiSettings {
  const settings = defaultAiSettings()
  settings.provider = 'anthropic'
  settings.providers.anthropic = { apiKey: '', model: local?.model ?? '' }
  return {
    ...settings,
    uniAiAvailable: false,
    modelSources: {
      anthropic: {
        chosen: 'claude-org-chosen',
        listed: ['claude-org-chosen', 'claude-sonnet-5'],
        origin: 'org',
      },
    },
  }
}

function localSettings(): AiSettings {
  const settings = defaultAiSettings()
  settings.provider = 'anthropic'
  settings.providers.anthropic = { apiKey: 'sk-local', model: 'claude-chosen' }
  return { ...settings, uniAiAvailable: false }
}

async function mount(settings: AiSettings, setSettings = vi.fn(async () => {})) {
  const bridge: AiModelPickerBridge = { getSettings: async () => settings, setSettings }
  await act(async () => {
    root.render(createElement(AiModelPicker, { bridge, lang: 'en' }))
  })
  await act(async () => {})
  return { setSettings }
}

const chip = () => host.querySelector('.ai-model-chip') as HTMLButtonElement
async function toggle(): Promise<void> {
  await act(async () => {
    chip().click()
  })
  await act(async () => {})
}
const liveText = () => host.querySelector('[aria-live]')!.textContent
const noteEl = () => host.querySelector('[data-org-key-note]')

describe('first-use note of a key on UniWork', () => {
  it('shows and announces the note on the first open only, also when closed without a pick', async () => {
    await mount(orgSettings())
    await toggle()
    expect(noteEl()?.textContent).toBe(en.orgKeyNote)
    expect(liveText()).toBe(en.orgKeyNote)
    await toggle() // closed with no pick
    await toggle()
    expect(noteEl()).toBeNull()
    expect(liveText()).not.toContain(en.orgKeyNote)
    // the tag stays: only the note was the first-use part
    expect(host.querySelector('[data-org-key-tag]')?.textContent).toBe(en.orgKeyTag)
  })

  it('stays quiet after a remount (the seen flag is persisted)', async () => {
    await mount(orgSettings())
    await toggle()
    await toggle()
    act(() => root.unmount())
    root = createRoot(host)
    await mount(orgSettings())
    await toggle()
    expect(noteEl()).toBeNull()
    expect(liveText()).toBe('')
    expect(window.localStorage.getItem('uniwork.ai.orgKeyNoteSeen.anthropic')).toBe('1')
  })

  it('stays quiet for the window when the store throws', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      await mount(orgSettings())
      await toggle()
      expect(noteEl()?.textContent).toBe(en.orgKeyNote)
      await toggle()
      await toggle()
      expect(noteEl()).toBeNull()
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('is kept per provider: a seen provider does not silence another one', async () => {
    window.localStorage.setItem('uniwork.ai.orgKeyNoteSeen.openai', '1')
    await mount(orgSettings())
    await toggle()
    expect(noteEl()?.textContent).toBe(en.orgKeyNote)
  })
})

describe('org origin in the accessible description', () => {
  it('describes every option of an org group by the tag and the note', async () => {
    await mount(orgSettings())
    await toggle()
    const options = [...host.querySelectorAll('[role=option]')]
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      const id = option.getAttribute('aria-describedby')
      expect(id).toBeTruthy()
      const text = document.getElementById(id!)?.textContent ?? ''
      expect(text).toContain(en.orgKeyTag)
      expect(text).toContain(en.orgKeyNote)
    }
  })

  it('leaves options of a local key without a description', async () => {
    await mount(localSettings())
    await toggle()
    for (const option of host.querySelectorAll('[role=option]')) {
      expect(option.getAttribute('aria-describedby')).toBeNull()
    }
  })
})

describe('the org model comes from modelSources', () => {
  it('reads the chip from the source chosen model, not from a model in the local slot', async () => {
    await mount(orgSettings({ model: 'claude-stale-local' }))
    expect(host.querySelector('.ai-model-chip-text')!.textContent).toBe('claude-org-chosen')
  })

  it('a pick sets the local choice and the source chosen model, the chip follows at once', async () => {
    const { setSettings } = await mount(orgSettings())
    await toggle()
    const option = [...host.querySelectorAll('[role=option]')].find(
      (o) => o.textContent === 'claude-sonnet-5',
    ) as HTMLButtonElement
    await act(async () => {
      option.click()
    })
    expect(host.querySelector('.ai-model-chip-text')!.textContent).toBe('claude-sonnet-5')
    const sent = setSettings.mock.calls[0]![0] as AiSettings
    expect(sent.providers.anthropic.model).toBe('claude-sonnet-5')
    expect(sent.providers.anthropic.apiKey).toBe('')
    expect(sent.modelSources?.anthropic?.chosen).toBe('claude-sonnet-5')
    expect(setSettings.mock.calls[0]![1]).toEqual({
      modelPick: { provider: 'anthropic', model: 'claude-sonnet-5' },
    })
  })
})

describe('a key saved on this computer renders as before', () => {
  it('keeps the chip text, an empty live region and the popover without org parts', async () => {
    await mount(localSettings())
    expect(host.querySelector('.ai-model-chip-text')!.textContent).toBe('claude-chosen')
    await toggle()
    expect(liveText()).toBe('')
    const pop = host.querySelector('.ai-model-pop') as HTMLElement
    expect(pop.getAttribute('style') ?? '').not.toMatch(/org/i)
    expect(pop.querySelector('[data-org-key-tag], [data-org-key-note], [data-origin]')).toBeNull()
    expect(pop.querySelector('.ai-model-org-tag, .ai-model-org-note')).toBeNull()
    expect(host.querySelector('[hidden]')).toBeNull()
  })
})

describe('org tag and note styling', () => {
  it('uses stylesheet classes with tokens and no inline style', async () => {
    await mount(orgSettings())
    await toggle()
    const tag = host.querySelector('[data-org-key-tag]') as HTMLElement
    const note = noteEl() as HTMLElement
    expect(tag.classList.contains('ai-model-org-tag')).toBe(true)
    expect(note.classList.contains('ai-model-org-note')).toBe(true)
    expect(tag.getAttribute('style')).toBeNull()
    expect(note.getAttribute('style')).toBeNull()
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/ai-model-picker.css'),
      'utf8',
    )
    for (const cls of ['ai-model-org-tag', 'ai-model-org-note']) {
      const block = css.match(new RegExp(`\\.${cls} \\{[^}]*\\}`))?.[0] ?? ''
      expect(block, cls).not.toBe('')
      expect(block, cls).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i)
    }
    // a long note wraps inside the popover instead of growing it past the list
    expect(css).toMatch(/\.ai-model-org-note \{[^}]*overflow-wrap: anywhere/)
  })
})
