import { describe, expect, it } from 'vitest'
import {
  aiSettingsFileOf,
  cloudToolsEnabled,
  defaultAiSettings,
  resolveAiSettings,
} from '../src/providers'

describe('aiSettingsFileOf', () => {
  it('keeps a boolean gskToolsEnabled and drops every other key, legacy root fields included', () => {
    expect(
      aiSettingsFileOf({
        provider: 'codex',
        apiKey: 'sk-old',
        providers: { openai: { apiKey: 'sk-1' } },
        media: { providers: {} },
        gskToolsEnabled: false,
      }),
    ).toEqual({ provider: 'uniwork', providers: {}, gskToolsEnabled: false })
  })

  it('omits a non-boolean opt-out and accepts any non-object input', () => {
    expect(aiSettingsFileOf({ provider: 'openai', apiKey: 'x', gskToolsEnabled: 'no' })).toEqual({
      provider: 'uniwork',
      providers: {},
    })
    for (const raw of [null, undefined, 'x', 3, []])
      expect(aiSettingsFileOf(raw)).toEqual({ provider: 'uniwork', providers: {} })
  })
})

describe('defaultAiSettings', () => {
  it('is UniWork AI with no provider slots and the cloud tools on', () => {
    const settings = defaultAiSettings()
    expect(settings.provider).toBe('uniwork')
    expect(Object.keys(settings.providers)).toEqual([])
    expect(settings.gskToolsEnabled).toBe(true)
  })
})

describe('gskToolsEnabled', () => {
  it('reads only the stored opt-out; any other stored field is ignored', () => {
    expect(resolveAiSettings({}, defaultAiSettings())).toEqual(defaultAiSettings())
    for (const stored of [null, 'settings', 7, true, []])
      expect(resolveAiSettings(stored, defaultAiSettings())).toEqual(defaultAiSettings())
    const off = resolveAiSettings(
      { provider: 'openai', providers: { openai: { apiKey: 'sk-1' } }, gskToolsEnabled: false },
      defaultAiSettings(),
    )
    expect(off).toEqual({ provider: 'uniwork', providers: {}, gskToolsEnabled: false })
    expect(resolveAiSettings({ gskToolsEnabled: 'no' }, defaultAiSettings()).gskToolsEnabled).toBe(
      true,
    )
  })

  it('keeps the stored toggle but stays off while the UniWork cloud seam is off', () => {
    expect(cloudToolsEnabled(defaultAiSettings())).toBe(false)
    expect(cloudToolsEnabled({ gskToolsEnabled: false })).toBe(false)
  })
})
