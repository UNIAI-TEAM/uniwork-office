/** @vitest-environment jsdom */
// G6-05m slice A: the chip shows the data its host hands over (Settings pick, live list, the served
// UniWork AI model), re-reads on every open, and keeps today's catalog chip when a host sends none.
// (A .ts file: this package's vitest include only matches tests/**/*.test.ts.)
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_PROVIDERS,
  defaultAiSettings,
  setUniworkAiAvailable,
  type AiModelSource,
  type AiSettings,
  type AiSettingsSaveOptions,
} from '@genoffice/ai-provider'
import { AiModelPicker, type AiModelPickerBridge } from '../src/AiModelPicker'
import { AI_MODEL_PICKER_STRINGS } from '../src/strings-ai-model-picker'

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
  setUniworkAiAvailable(false)
  vi.unstubAllGlobals()
})

const anthropicModels = AI_PROVIDERS.find((m) => m.id === 'anthropic')!.models

function anthropic(modelSources?: AiSettings['modelSources']): AiSettings {
  const settings = defaultAiSettings()
  settings.provider = 'anthropic'
  settings.providers.anthropic = { apiKey: '…wxyz', model: 'claude-chosen' }
  return { ...settings, uniAiAvailable: false, modelSources }
}

interface Mounted {
  reads: () => number
  emitChanged: () => Promise<void>
  setNext: (next: AiSettings) => void
  open: () => Promise<void>
}

async function mount(
  first: AiSettings,
  lang: 'en' | 'vi' = 'en',
  onAnnounce?: (text: string) => void,
): Promise<Mounted> {
  let current = first
  let reads = 0
  const handlers = new Set<() => void>()
  const bridge: AiModelPickerBridge = {
    getSettings: async () => (reads++, current),
    setSettings: async () => {},
    onSettingsChanged: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
  await act(async () => {
    root.render(createElement(AiModelPicker, { bridge, lang, onAnnounce }))
  })
  await act(async () => {})
  return {
    reads: () => reads,
    setNext: (next) => {
      current = next
    },
    emitChanged: async () => {
      await act(async () => {
        for (const h of handlers) h()
      })
      await act(async () => {})
    },
    open: async () => {
      await act(async () => {
        ;(host.querySelector('.ai-model-chip') as HTMLButtonElement).click()
      })
      await act(async () => {})
    },
  }
}

const rows = () =>
  [...host.querySelectorAll('.ai-model-item:not(.ai-model-manage)')].map((n) => n.textContent)

describe('the chip reads the host data', () => {
  it('lists the Settings pick first, then the live list instead of the catalog', async () => {
    const m = await mount(
      anthropic({ anthropic: { chosen: 'claude-chosen', listed: ['live-b', 'live-a'] } }),
    )
    await m.open()
    expect(rows()).toEqual(['claude-chosen', 'live-a', 'live-b'])
    expect(host.querySelector('.ai-model-chip-text')!.textContent).toBe('claude-chosen')
  })

  it('settings without modelSources render the catalog chip, as before', async () => {
    const m = await mount(anthropic())
    await m.open()
    expect(rows()).toEqual(['claude-chosen', ...anthropicModels])
  })

  it('opening the chip reads the settings again, every time', async () => {
    const m = await mount(anthropic({ anthropic: { chosen: 'claude-chosen' } }))
    const mounted = m.reads()
    await m.open()
    expect(m.reads()).toBe(mounted + 1)
    await m.open() // close
    await m.open()
    expect(m.reads()).toBe(mounted + 2)
  })

  it('a re-read with a new live list re-renders the list that is open', async () => {
    const m = await mount(
      anthropic({ anthropic: { chosen: 'claude-chosen', listState: 'loading' } }),
    )
    await m.open()
    expect(rows()).toEqual(['claude-chosen', ...anthropicModels])
    m.setNext(anthropic({ anthropic: { chosen: 'claude-chosen', listed: ['live-a'] } }))
    await m.emitChanged()
    expect(rows()).toEqual(['claude-chosen', 'live-a'])
    expect(host.querySelector('.ai-model-pop')).not.toBeNull()
  })

  it('a pick still writes the whole selection through the bridge', async () => {
    const setSettings = vi.fn(async () => {})
    const bridge: AiModelPickerBridge = {
      getSettings: async () =>
        anthropic({ anthropic: { chosen: 'claude-chosen', listed: ['live-a'] } }),
      setSettings,
    }
    await act(async () => {
      root.render(createElement(AiModelPicker, { bridge, lang: 'en' }))
    })
    await act(async () => {})
    await act(async () => {
      ;(host.querySelector('.ai-model-chip') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(host.querySelectorAll('.ai-model-item')[1] as HTMLButtonElement).click()
    })
    expect(setSettings).toHaveBeenCalledTimes(1)
    const [saved, options] = setSettings.mock.calls[0] as unknown as [
      AiSettings,
      AiSettingsSaveOptions,
    ]
    expect(saved.provider).toBe('anthropic')
    expect(saved.providers.anthropic.model).toBe('live-a')
    // the pick says so explicitly: main records a model pick from this marker only
    expect(options).toEqual({ modelPick: { provider: 'anthropic', model: 'live-a' } })
  })
})

describe('list state note', () => {
  it('says the list is loading while the catalog shows', async () => {
    const m = await mount(
      anthropic({ anthropic: { chosen: 'claude-chosen', listState: 'loading' } }),
    )
    await m.open()
    expect(host.querySelector('.ai-model-pop')!.textContent).toContain(
      AI_MODEL_PICKER_STRINGS.en.modelsLoading,
    )
    expect(host.textContent).not.toContain(AI_MODEL_PICKER_STRINGS.en.modelsUnavailable)
  })

  it('says the list is unavailable after a failed listing, and still lists the catalog', async () => {
    const m = await mount(anthropic({ anthropic: { chosen: 'claude-chosen', listState: 'error' } }))
    await m.open()
    expect(host.querySelector('.ai-model-pop')!.textContent).toContain(
      AI_MODEL_PICKER_STRINGS.en.modelsUnavailable,
    )
    expect(rows()).toEqual(['claude-chosen', ...anthropicModels])
  })

  it('writes the note through onAnnounce and mounts no live region of its own (RF6-1)', async () => {
    const announce = vi.fn()
    const m = await mount(
      anthropic({ anthropic: { chosen: 'claude-chosen', listState: 'loading' } }),
      'en',
      announce,
    )
    expect(host.querySelector('[aria-live]')).toBeNull()
    await m.open()
    expect(announce).toHaveBeenLastCalledWith(AI_MODEL_PICKER_STRINGS.en.modelsLoading)
    // the Floor: fixed live nodes only, never one mounted at runtime; the panel owns the node
    expect(host.querySelector('[aria-live], [role=status], [role=alert]')).toBeNull()
  })

  it('announces the failure the same way, and nothing when the list is fine', async () => {
    const failed = vi.fn()
    const f = await mount(
      anthropic({ anthropic: { chosen: 'claude-chosen', listState: 'error' } }),
      'en',
      failed,
    )
    await f.open()
    expect(failed).toHaveBeenLastCalledWith(AI_MODEL_PICKER_STRINGS.en.modelsUnavailable)
    act(() => root.unmount())
    root = createRoot(host)
    const fine = vi.fn()
    const m = await mount(
      anthropic({ anthropic: { chosen: 'claude-chosen', listed: ['a'] } }),
      'en',
      fine,
    )
    await m.open()
    expect(fine.mock.calls.filter(([text]) => text !== '')).toEqual([])
    expect(host.querySelector('[aria-live]')).toBeNull()
  })

  it('announces nothing without the prop (no region of its own either)', async () => {
    const m = await mount(
      anthropic({ anthropic: { chosen: 'claude-chosen', listState: 'loading' } }),
    )
    await m.open()
    expect(host.querySelector('[aria-live]')).toBeNull()
  })

  it('says nothing when the list is fine or not asked', async () => {
    const m = await mount(anthropic({ anthropic: { chosen: 'claude-chosen', listed: ['a'] } }))
    await m.open()
    const text = host.querySelector('.ai-model-pop')!.textContent ?? ''
    expect(text).not.toContain(AI_MODEL_PICKER_STRINGS.en.modelsLoading)
    expect(text).not.toContain(AI_MODEL_PICKER_STRINGS.en.modelsUnavailable)
  })

  it('uses only classes the picker stylesheet already defines', async () => {
    const m = await mount(anthropic({ anthropic: { chosen: 'claude-chosen', listState: 'error' } }))
    await m.open()
    // resolved from this file, so it works from the repo root (--root packages/ui) and the package
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/ai-model-picker.css'),
      'utf8',
    )
    for (const el of host.querySelectorAll('.ai-model-pop *')) {
      for (const cls of el.classList)
        if (cls.startsWith('ai-model')) expect(css).toContain(`.${cls}`)
    }
  })
})

describe('UniWork AI row', () => {
  function uniwork(uniworkModel?: string): AiSettings {
    return { ...defaultAiSettings(), provider: 'uniwork', uniAiAvailable: false, uniworkModel }
  }

  it('shows the served model on the row when the host knows it', async () => {
    setUniworkAiAvailable(true)
    const m = await mount(uniwork('claude-opus-5'))
    await m.open()
    expect(rows()).toEqual(['claude-opus-5'])
    expect(host.querySelector('.ai-model-item.selected')).not.toBeNull()
  })

  it.each([undefined, ''])(
    'reads "UniWork AI" when the model is %j (older server)',
    async (model) => {
      setUniworkAiAvailable(true)
      const m = await mount(uniwork(model))
      await m.open()
      expect(rows()).toEqual(['UniWork AI'])
    },
  )

  it('follows a model that arrives with a later read', async () => {
    setUniworkAiAvailable(true)
    const m = await mount(uniwork(''))
    await m.open()
    expect(rows()).toEqual(['UniWork AI'])
    m.setNext(uniwork('claude-opus-5'))
    await m.emitChanged()
    expect(rows()).toEqual(['claude-opus-5'])
  })
})

describe('a provider without a key', () => {
  /** a keyless slot whose source carries a model and an unknown `origin` marker (read like any other) */
  function keylessAnthropic(): AiSettings {
    const settings = defaultAiSettings()
    settings.provider = 'anthropic'
    settings.providers.anthropic = { apiKey: '', model: '' }
    return {
      ...settings,
      uniAiAvailable: false,
      modelSources: {
        anthropic: {
          chosen: 'claude-source-chosen',
          listed: ['claude-source-chosen', 'claude-sonnet-5'],
          origin: 'org',
        } as AiModelSource,
      },
    }
  }

  it.each(['en', 'vi'] as const)(
    'is not listed and the chip asks for a model in %s, whatever its source says',
    async (lang) => {
      const announce = vi.fn()
      const m = await mount(keylessAnthropic(), lang, announce)
      expect(host.querySelector('.ai-model-chip-text')!.textContent).toBe(
        AI_MODEL_PICKER_STRINGS[lang].choose,
      )
      await m.open()
      const pop = host.querySelector('.ai-model-pop')!
      expect(pop.textContent).not.toContain('claude-source-chosen')
      expect(pop.textContent).not.toContain(lang === 'vi' ? 'Khóa trên UniWork' : 'Key on UniWork')
      expect(announce).not.toHaveBeenCalled()
    },
  )
})

describe('strings', () => {
  it('vi and en carry real copy for the new keys', () => {
    expect(AI_MODEL_PICKER_STRINGS.vi.modelsLoading).toBe('Đang tải danh sách mô hình…')
    expect(AI_MODEL_PICKER_STRINGS.vi.modelsUnavailable).toBe(
      'Không tải được danh sách mô hình, đang hiện danh sách gợi ý',
    )
    expect(AI_MODEL_PICKER_STRINGS.en.modelsLoading).toBe('Loading models…')
    expect(AI_MODEL_PICKER_STRINGS.en.modelsUnavailable).toBe(
      "Couldn't load the model list; showing suggestions",
    )
  })

  it('every locale has all keys, non-empty', () => {
    for (const [lang, s] of Object.entries(AI_MODEL_PICKER_STRINGS)) {
      expect(s.modelsLoading.trim(), lang).not.toBe('')
      expect(s.modelsUnavailable.trim(), lang).not.toBe('')
    }
  })
})
