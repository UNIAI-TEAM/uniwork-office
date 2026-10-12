import { describe, expect, it } from 'vitest'
import { defaultAiSettings } from '@genoffice/ai-provider'
import * as options from '../src/ai-model-picker-options'
import { aiModelPickerGroups, aiModelPickerSelection } from '../src/ai-model-picker-options'

// not on the base commit: read it off the module so the failure is an assertion
const aiModelPickerNeed = (s: unknown): string | null =>
  (options as unknown as Record<string, (s: unknown) => string | null>).aiModelPickerNeed!(s)

describe('UNI-1395: the picker keeps an unusable selection', () => {
  it('stored openai without a key stays openai (needs-key), not uniAI', () => {
    const settings = defaultAiSettings()
    settings.provider = 'openai'
    expect(aiModelPickerSelection(settings).provider).toBe('openai')
    expect(aiModelPickerNeed(settings)).toBe('key')
    // nothing usable to list, so the chip reads "Choose model"
    expect(aiModelPickerGroups(settings, false).some((g) => g.id === 'openai')).toBe(false)
  })

  it('stored custom endpoint with a blank model stays custom (choose-model)', () => {
    const settings = defaultAiSettings()
    settings.provider = 'custom'
    settings.providers.custom = { apiKey: '', model: '', baseUrl: 'http://localhost:11434/v1' }
    expect(aiModelPickerSelection(settings).provider).toBe('custom')
    expect(aiModelPickerNeed(settings)).toBe('model')
  })

  it('a usable selection and uniAI report no need', () => {
    const usable = defaultAiSettings()
    usable.provider = 'anthropic'
    usable.providers.anthropic = { apiKey: 'k', model: 'claude-x' }
    expect(aiModelPickerNeed(usable)).toBeNull()
    expect(aiModelPickerNeed(defaultAiSettings())).toBeNull()
  })
})
