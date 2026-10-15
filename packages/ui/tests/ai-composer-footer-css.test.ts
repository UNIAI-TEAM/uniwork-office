/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { defaultAiSettings } from '@genoffice/ai-provider'
import { AiModelPicker, type AiModelPickerBridge } from '../src/AiModelPicker'

const src = (f: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src', f), 'utf8')

/** the declarations of the first rule whose selector is exactly `selector` */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} is styled`).toBeGreaterThanOrEqual(0)
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

describe('composer footer: model picker and usage chip', () => {
  // V5: the picker chip refused to shrink (flex-shrink: 0) inside a shrinking wrapper, so a
  // crowded footer (Docs: picker + session chip + attach + track-changes + send) painted the
  // chip label over the usage chip. The label now yields (ellipsis) and the usage chip holds.
  it('lets the model chip shrink to an ellipsis instead of spilling over its neighbours', () => {
    const chip = rule(src('ai-model-picker.css'), '.ai-model-chip')
    expect(chip).not.toMatch(/flex-shrink:\s*0/)
    expect(chip).toMatch(/min-width:\s*\d+px/)
    expect(rule(src('ai-model-picker.css'), '.ai-model-chip-text')).toMatch(
      /text-overflow:\s*ellipsis/,
    )
  })

  it('keeps the usage chip at its natural width', () => {
    expect(rule(src('ai-usage.css'), '.ai-usage-chip')).toMatch(/flex-shrink:\s*0/)
  })

  // N1: 56px floor left only 26px of text ("C..." / "cl...") in the crowded Docs footer.
  // Raise the floor so ~8-10 characters stay visible, shrink the model chip first while the
  // footer has room, and let the footer usage chip yield once the model chip hits its floor.
  it('raises the model chip floor for ~8-10 chars and lets the footer usage chip yield when crowded (N1)', () => {
    const picker = rule(src('ai-model-picker.css'), '.ai-model-picker')
    const chip = rule(src('ai-model-picker.css'), '.ai-model-chip')
    const pickerMin = /min-width:\s*(\d+)px/.exec(picker)
    const chipMin = /min-width:\s*(\d+)px/.exec(chip)
    expect(Number(pickerMin?.[1])).toBeGreaterThanOrEqual(84)
    expect(Number(chipMin?.[1])).toBeGreaterThanOrEqual(84)
    const shrink = /flex-shrink:\s*(\d+)/.exec(picker)
    expect(Number(shrink?.[1])).toBeGreaterThanOrEqual(100)

    const footerUsage = rule(src('ai-usage.css'), '.ai-input-footer .ai-usage-chip')
    expect(footerUsage).toMatch(/flex-shrink:\s*1/)
    expect(footerUsage).toMatch(/min-width:\s*0/)
    expect(footerUsage).toMatch(/overflow:\s*hidden/)
    expect(footerUsage).toMatch(/text-overflow:\s*ellipsis/)
  })

  // F8 (visual r1): at the 360 px panel with the usage chip + Track changes, the floor of 88px cut
  // "UniWork AI" to "Uni…". The floor now fits the provider name (logo + 10 characters + caret);
  // the usage chip, which already yields (ellipsis + title), absorbs the squeeze instead.
  it('keeps the floor wide enough for the "UniWork AI" label next to the usage chip (F8)', () => {
    const picker = rule(src('ai-model-picker.css'), '.ai-model-picker')
    const chip = rule(src('ai-model-picker.css'), '.ai-model-chip')
    expect(Number(/min-width:\s*(\d+)px/.exec(picker)?.[1])).toBeGreaterThanOrEqual(116)
    expect(Number(/min-width:\s*(\d+)px/.exec(chip)?.[1])).toBeGreaterThanOrEqual(116)
    // no raw colors sneak in with the change
    expect(picker + chip).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/)
  })

  it('exposes the full model name on the chip via title, data-tip, and aria-label (N1)', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      const settings = { ...defaultAiSettings(), provider: 'anthropic' as const }
      const longModel = 'claude-sonnet-5-5-extended-thinking-preview-2026'
      settings.providers.anthropic = {
        ...settings.providers.anthropic,
        apiKey: 'sk-ant-test',
        model: longModel,
      }
      const bridge: AiModelPickerBridge = {
        getSettings: async () => settings,
        setSettings: async () => {},
      }
      await act(async () => {
        root.render(createElement(AiModelPicker, { bridge, lang: 'en' }))
      })
      await act(async () => {})
      const chip = host.querySelector('.ai-model-chip') as HTMLButtonElement
      const expected = `Model: ${longModel}`
      expect(chip.getAttribute('title')).toBe(expected)
      expect(chip.getAttribute('data-tip')).toBe(expected)
      expect(chip.getAttribute('aria-label')).toBe(expected)
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  // V8: --text-tertiary on white is 3.05:1 at 11 px (needs 4.5:1)
  it('paints the usage chip with --text-secondary', () => {
    const decl = rule(src('ai-usage.css'), '.ai-usage-chip')
    expect(decl).toMatch(/color:\s*var\(--text-secondary\)/)
    expect(decl).not.toMatch(/text-tertiary/)
  })
})
