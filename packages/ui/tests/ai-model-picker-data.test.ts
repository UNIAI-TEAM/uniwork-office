/** @vitest-environment jsdom */
// The chip shows the data its host hands over: the model UniWork AI serves (`uniworkModel`), read
// again when the settings change, and "UniWork AI" while the host knows none (UNI-2309: UniWork AI
// is the one provider, so there is no list to show).
// (A .ts file: this package's vitest include only matches tests/**/*.test.ts.)
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings, setUniworkAiAvailable, type AiSettings } from '@genoffice/ai-provider'
import { AiModelPicker, type AiModelPickerBridge } from '../src/AiModelPicker'
import { AI_MODEL_PICKER_STRINGS } from '../src/strings-ai-model-picker'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  setUniworkAiAvailable(true)
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

function uniwork(uniworkModel?: string): AiSettings {
  return { ...defaultAiSettings(), uniworkModel }
}

async function mount(first: AiSettings) {
  let current = first
  const handlers = new Set<() => void>()
  const bridge: AiModelPickerBridge = {
    getSettings: async () => current,
    onSettingsChanged: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
  await act(async () => {
    root.render(createElement(AiModelPicker, { bridge, lang: 'en' }))
  })
  await act(async () => {})
  return {
    setNext: (next: AiSettings) => {
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
        host.querySelector<HTMLButtonElement>('.ai-model-chip')!.click()
      })
      await act(async () => {})
    },
  }
}

const chipText = () => host.querySelector('.ai-model-chip-text')!.textContent

describe('the chip reads the host data', () => {
  it('shows the served model when the host knows it, in the chip and the popover', async () => {
    const m = await mount(uniwork('claude-opus-5'))
    expect(chipText()).toBe('claude-opus-5')
    await m.open()
    expect(host.querySelector('.ai-model-current .ai-model-item-text')!.textContent).toBe(
      'claude-opus-5',
    )
  })

  it.each([undefined, ''])(
    'reads "UniWork AI" when the model is %j (older server)',
    async (model) => {
      await mount(uniwork(model))
      expect(chipText()).toBe('UniWork AI')
    },
  )

  it('follows a model that arrives with a later read', async () => {
    const m = await mount(uniwork(''))
    expect(chipText()).toBe('UniWork AI')
    m.setNext(uniwork('claude-opus-5'))
    await m.emitChanged()
    expect(chipText()).toBe('claude-opus-5')
  })

  it('a legacy settings file naming another provider still shows UniWork AI', async () => {
    await mount({ ...defaultAiSettings(), provider: 'anthropic' })
    expect(chipText()).toBe('UniWork AI')
  })

  it('uses only classes the picker stylesheet already defines', async () => {
    const m = await mount(uniwork('claude-opus-5'))
    await m.open()
    // resolved from this file, so it works from the repo root (--root packages/ui) and the package
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/ai-model-picker.css'),
      'utf8',
    )
    for (const el of host.querySelectorAll(
      '.ai-model-picker, .ai-model-picker *, .ai-model-pop *',
    )) {
      for (const cls of el.classList)
        if (cls.startsWith('ai-model')) expect(css).toContain(`.${cls}`)
    }
  })
})

describe('strings', () => {
  it('vi and en say UniWork AI is not on, never to pick a model or add a key', () => {
    expect(AI_MODEL_PICKER_STRINGS.vi.needModel).toBe(
      'UniWork AI chưa bật cho định dạng hoặc tổ chức này',
    )
    expect(AI_MODEL_PICKER_STRINGS.en.needModel).toBe(
      'UniWork AI isn’t on for this format or organization',
    )
  })

  it('every locale has a title and the hint, and only those', () => {
    for (const [lang, s] of Object.entries(AI_MODEL_PICKER_STRINGS)) {
      expect(Object.keys(s).sort(), lang).toEqual(['needModel', 'title'])
      expect(s.title.trim(), lang).not.toBe('')
      expect(s.needModel, lang).toContain('UniWork AI')
    }
  })
})
