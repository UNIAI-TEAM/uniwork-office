/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings } from '@genoffice/ai-provider'
import { AiModelPicker, type AiModelPickerBridge } from '../src/AiModelPicker'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function makeBridge(): AiModelPickerBridge {
  const settings = { ...defaultAiSettings(), provider: 'openai' as const }
  settings.providers.openai = {
    ...settings.providers.openai,
    apiKey: 'sk-test',
    model: 'gpt-5.4-mini',
  }
  return {
    getSettings: async () => settings,
    setSettings: async () => {},
  }
}

describe('AiModelPicker popover positioning under CSS zoom (R3-2)', () => {
  it('keeps zoom 1 positioning and 420px cap unchanged', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700)
    await act(async () => {
      root.render(createElement(AiModelPicker, { bridge: makeBridge(), lang: 'en' }))
    })
    await act(async () => {})

    const chip = host.querySelector('.ai-model-chip') as HTMLButtonElement
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue({
      x: 23,
      y: 649,
      top: 649,
      left: 23,
      right: 130,
      bottom: 673,
      width: 107,
      height: 24,
      toJSON: () => ({}),
    })

    await act(async () => {
      chip.click()
    })

    const pop = host.querySelector('.ai-model-pop') as HTMLDivElement
    expect(pop).not.toBeNull()
    const cs = window.getComputedStyle(pop)
    expect(parseFloat(cs.left)).toBeCloseTo(23, 2)
    expect(parseFloat(cs.bottom)).toBeCloseTo(57, 2)
    expect(parseFloat(cs.maxHeight)).toBeCloseTo(420, 2)
  })

  it('divides bottom, left, and viewport max-height cap by ancestor CSS zoom (150%)', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700)
    host.style.zoom = '1.5'

    await act(async () => {
      root.render(createElement(AiModelPicker, { bridge: makeBridge(), lang: 'en' }))
    })
    await act(async () => {})

    const chip = host.querySelector('.ai-model-chip') as HTMLButtonElement
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue({
      x: 34,
      y: 624,
      top: 624,
      left: 34,
      right: 194,
      bottom: 660,
      width: 160,
      height: 36,
      toJSON: () => ({}),
    })

    await act(async () => {
      chip.click()
    })

    const pop = host.querySelector('.ai-model-pop') as HTMLDivElement
    expect(pop).not.toBeNull()
    const cs = window.getComputedStyle(pop)
    expect(parseFloat(cs.left)).toBeCloseTo(34 / 1.5, 2)
    expect(parseFloat(cs.bottom)).toBeCloseTo((700 - 624 + 6) / 1.5, 2)
    expect(parseFloat(cs.maxHeight)).toBeCloseTo((700 * 0.7) / 1.5, 2)
  })

  it('falls back to currentCSSZoom when computed style zoom is unset (125%)', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700)

    await act(async () => {
      root.render(createElement(AiModelPicker, { bridge: makeBridge(), lang: 'en' }))
    })
    await act(async () => {})

    const chip = host.querySelector('.ai-model-chip') as HTMLButtonElement
    Object.defineProperty(chip, 'currentCSSZoom', { value: 1.25, configurable: true })
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue({
      x: 28.5,
      y: 636.5,
      top: 636.5,
      left: 28.5,
      right: 162,
      bottom: 666.5,
      width: 133.5,
      height: 30,
      toJSON: () => ({}),
    })

    await act(async () => {
      chip.click()
    })

    const pop = host.querySelector('.ai-model-pop') as HTMLDivElement
    expect(pop).not.toBeNull()
    const cs = window.getComputedStyle(pop)
    expect(parseFloat(cs.left)).toBeCloseTo(28.5 / 1.25, 2)
    expect(parseFloat(cs.bottom)).toBeCloseTo((700 - 636.5 + 6) / 1.25, 2)
    expect(parseFloat(cs.maxHeight)).toBeCloseTo((700 * 0.7) / 1.25, 2)
  })

  it('caps .ai-model-pop max-height in ai-model-picker.css with scale-aware --ui-vh fallback', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/ai-model-picker.css'),
      'utf8',
    )
    const start = css.indexOf('.ai-model-pop {')
    const block = css.slice(start, css.indexOf('}', start))
    expect(block).toMatch(/max-height:\s*min\(420px,\s*calc\(var\(--ui-vh,\s*1vh\)\s*\*\s*70\)\)/)
  })
})
