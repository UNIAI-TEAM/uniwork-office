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
  type AiSettings,
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

async function mount(first: AiSettings, lang: 'en' | 'vi' = 'en'): Promise<Mounted> {
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
    root.render(createElement(AiModelPicker, { bridge, lang }))
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
    const [saved] = setSettings.mock.calls[0] as unknown as [AiSettings]
    expect(saved.provider).toBe('anthropic')
    expect(saved.providers.anthropic.model).toBe('live-a')
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

  it('announces the note through one polite live region outside the listbox', async () => {
    const m = await mount(
      anthropic({ anthropic: { chosen: 'claude-chosen', listState: 'loading' } }),
    )
    await m.open()
    const regions = host.querySelectorAll('[aria-live]')
    expect(regions).toHaveLength(1)
    const region = regions[0]!
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe(AI_MODEL_PICKER_STRINGS.en.modelsLoading)
    expect(region.closest('[role=listbox]')).toBeNull()
    // a listbox owns options and groups only: no live region or status inside it
    expect(
      host.querySelector('[role=listbox] [aria-live], [role=listbox] [role=status]'),
    ).toBeNull()
  })

  it('announces the failure the same way, and nothing when the list is fine', async () => {
    const failed = await mount(
      anthropic({ anthropic: { chosen: 'claude-chosen', listState: 'error' } }),
    )
    await failed.open()
    expect(host.querySelector('[aria-live]')!.textContent).toBe(
      AI_MODEL_PICKER_STRINGS.en.modelsUnavailable,
    )
    act(() => root.unmount())
    root = createRoot(host)
    const fine = await mount(anthropic({ anthropic: { chosen: 'claude-chosen', listed: ['a'] } }))
    await fine.open()
    expect(host.querySelector('[aria-live]')?.textContent ?? '').toBe('')
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

describe('org-origin key source (G6-05k)', () => {
  function orgAnthropic(origin?: 'local' | 'org'): AiSettings {
    const settings = defaultAiSettings()
    settings.provider = 'anthropic'
    // org source has no local apiKey in ai-settings.json (never copy key_hint into apiKey)
    settings.providers.anthropic = {
      apiKey: origin === 'org' ? '' : 'sk-local',
      model: '',
    }
    return {
      ...settings,
      uniAiAvailable: false,
      modelSources: {
        anthropic: {
          chosen: 'claude-org-chosen',
          listed: ['claude-org-chosen', 'claude-sonnet-5'],
          ...(origin ? { origin } : {}),
        },
      },
    }
  }

  it.each(['en', 'vi'] as const)(
    'renders the org key tag, tooltip, and first-use privacy note in %s',
    async (lang) => {
      const m = await mount(orgAnthropic('org'), lang)
      expect(host.querySelector('.ai-model-chip-text')!.textContent).toBe('claude-org-chosen')
      await m.open()
      const tag = host.querySelector('[data-org-key-tag]') as HTMLElement | null
      expect(tag).not.toBeNull()
      expect(tag!.textContent).toBe(AI_MODEL_PICKER_STRINGS[lang].orgKeyTag)
      expect(tag!.getAttribute('title')).toBe(AI_MODEL_PICKER_STRINGS[lang].orgKeyNote)
      expect(tag!.getAttribute('data-tip')).toBe(AI_MODEL_PICKER_STRINGS[lang].orgKeyNote)

      const note = host.querySelector('[data-org-key-note]') as HTMLElement | null
      expect(note).not.toBeNull()
      expect(note!.textContent).toBe(AI_MODEL_PICKER_STRINGS[lang].orgKeyNote)
      expect(host.querySelector('[aria-live]')!.textContent).toBe(
        AI_MODEL_PICKER_STRINGS[lang].orgKeyNote,
      )
      expect(
        host.querySelector('[role=listbox] [aria-live], [role=listbox] [role=status]'),
      ).toBeNull()

      // after picking a model in the org group, the first-use note is dismissed while the tag stays
      await act(async () => {
        ;(host.querySelectorAll('.ai-model-item')[1] as HTMLButtonElement).click()
      })
      await m.open()
      expect(host.querySelector('[data-org-key-tag]')!.textContent).toBe(
        AI_MODEL_PICKER_STRINGS[lang].orgKeyTag,
      )
      expect(host.querySelector('[data-org-key-note]')).toBeNull()
    },
  )

  it.each([undefined, 'local' as const])(
    'renders as today when origin is %j (no org tag or privacy note)',
    async (origin) => {
      const m = await mount(orgAnthropic(origin))
      await m.open()
      expect(host.querySelector('[data-org-key-tag]')).toBeNull()
      expect(host.querySelector('[data-org-key-note]')).toBeNull()
      expect(host.querySelector('.ai-model-pop')!.textContent).not.toContain(
        AI_MODEL_PICKER_STRINGS.en.orgKeyTag,
      )
      expect(host.querySelector('.ai-model-pop')!.textContent).not.toContain(
        AI_MODEL_PICKER_STRINGS.en.orgKeyNote,
      )
    },
  )
})

describe('strings', () => {
  it('vi and en carry real copy for the new keys', () => {
    expect(AI_MODEL_PICKER_STRINGS.vi.modelsLoading).toBe('Đang tải danh sách mô hình…')
    expect(AI_MODEL_PICKER_STRINGS.vi.modelsUnavailable).toBe(
      'Không tải được danh sách mô hình, đang hiện danh sách gợi ý',
    )
    expect(AI_MODEL_PICKER_STRINGS.vi.orgKeyTag).toBe('Khóa trên UniWork')
    expect(AI_MODEL_PICKER_STRINGS.vi.orgKeyNote).toBe(
      'Gửi qua máy chủ UniWork của tổ chức bằng khóa bạn đã lưu trên UniWork. UniWork chỉ ghi số liệu sử dụng, không lưu nội dung.',
    )
    expect(AI_MODEL_PICKER_STRINGS.vi.orgKeyManage).toBe('Quản lý khóa trên UniWork (web)')
    expect(AI_MODEL_PICKER_STRINGS.en.modelsLoading).toBe('Loading models…')
    expect(AI_MODEL_PICKER_STRINGS.en.modelsUnavailable).toBe(
      "Couldn't load the model list; showing suggestions",
    )
    expect(AI_MODEL_PICKER_STRINGS.en.orgKeyTag).toBe('Key on UniWork')
    expect(AI_MODEL_PICKER_STRINGS.en.orgKeyNote).toBe(
      "Sent through your organization's UniWork server with the key you saved on UniWork. UniWork records usage only and does not store the content.",
    )
    expect(AI_MODEL_PICKER_STRINGS.en.orgKeyManage).toBe('Manage keys on UniWork (web)')
  })

  it('every locale has all keys, non-empty, with no internal codes or forbidden terms', () => {
    for (const [lang, s] of Object.entries(AI_MODEL_PICKER_STRINGS)) {
      expect(s.modelsLoading.trim(), lang).not.toBe('')
      expect(s.modelsUnavailable.trim(), lang).not.toBe('')
      expect(s.orgKeyTag.trim(), lang).not.toBe('')
      expect(s.orgKeyNote.trim(), lang).not.toBe('')
      expect(s.orgKeyManage.trim(), lang).not.toBe('')
      for (const copy of [s.orgKeyTag, s.orgKeyNote, s.orgKeyManage]) {
        expect(copy, lang).not.toMatch(/BYOK|proxy|G6-|UNI-\d|Q-K|git|GitHub/i)
      }
    }
  })
})
