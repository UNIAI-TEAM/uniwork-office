import { describe, expect, it } from 'vitest'
import { AI_PROVIDERS, defaultAiSettings } from '@genoffice/ai-provider'
import {
  aiModelPickerGroups,
  aiModelPickerSelection,
  withAiModelSelection,
} from '../src/ai-model-picker-options'

const anthropicModels = AI_PROVIDERS.find((m) => m.id === 'anthropic')!.models

describe('aiModelPickerGroups', () => {
  it('lists nothing while signed out with no keys', () => {
    expect(aiModelPickerGroups(defaultAiSettings(), false)).toEqual([])
  })

  it('lists uniAI when signed in', () => {
    const ids = aiModelPickerGroups(defaultAiSettings(), true).map((g) => g.id)
    expect(ids).toEqual(['genspark'])
  })

  it('lists uniAI once a Token Hub key is set, from either key slot', () => {
    const own = defaultAiSettings()
    own.providers.genspark = { ...own.providers.genspark, apiKey: 'sk-or-1' }
    expect(aiModelPickerGroups(own, false).map((g) => g.id)).toContain('genspark')
    const shared = defaultAiSettings()
    shared.providers.openrouter = { ...shared.providers.openrouter, apiKey: 'sk-or-2' }
    expect(aiModelPickerGroups(shared, false).map((g) => g.id)).toContain('genspark')
  })

  it('adds a vendor once its key is set and puts an off-catalog model first', () => {
    const settings = defaultAiSettings()
    settings.providers.anthropic = { apiKey: 'k', model: 'claude-next' }
    const groups = aiModelPickerGroups(settings, false)
    expect(groups.map((g) => g.id)).toEqual(['anthropic'])
    expect(groups[0]!.models).toEqual(['claude-next', ...anthropicModels])
  })

  it('needs a base URL for custom endpoints', () => {
    const settings = defaultAiSettings()
    settings.providers.custom = { apiKey: '', model: 'llama', baseUrl: '' }
    expect(aiModelPickerGroups(settings, false)).toEqual([])
    settings.providers.custom = { apiKey: '', model: 'llama', baseUrl: 'http://localhost:11434/v1' }
    expect(aiModelPickerGroups(settings, false).map((g) => g.id)).toEqual(['custom'])
  })
})

describe('hosts without the UniAI pool (web frames)', () => {
  it('never lists uniAI nor names openrouter/auto, even while the cloud sign-in is reported', () => {
    const settings = { ...defaultAiSettings(), uniAiAvailable: false }
    expect(aiModelPickerGroups(settings, true)).toEqual([])
    settings.providers.genspark = { ...settings.providers.genspark, apiKey: 'sk-or-1' }
    expect(aiModelPickerGroups(settings, true)).toEqual([])
  })

  it('lists the viewer provider that carries a (masked) key and selects its model', () => {
    const settings = {
      ...defaultAiSettings(),
      uniAiAvailable: false,
      provider: 'anthropic' as const,
    }
    settings.providers.anthropic = { apiKey: '…wxyz', model: anthropicModels[1]! }
    expect(aiModelPickerGroups(settings, true).map((g) => g.id)).toEqual(['anthropic'])
    expect(aiModelPickerSelection(settings)).toEqual({
      provider: 'anthropic',
      model: anthropicModels[1],
    })
  })

  it('no stored key: the selection falls to uniAI but nothing is listed, so the chip says Choose model', () => {
    const settings = { ...defaultAiSettings(), uniAiAvailable: false, provider: 'openai' as const }
    expect(aiModelPickerGroups(settings, true)).toEqual([])
    expect(
      aiModelPickerGroups(settings, true).some(
        (g) => g.id === aiModelPickerSelection(settings).provider,
      ),
    ).toBe(false)
  })
})

describe('selection round trip', () => {
  it('switches provider and model in one write and reads back', () => {
    const settings = defaultAiSettings()
    settings.providers.anthropic = { apiKey: 'k', model: anthropicModels[0]! }
    const next = withAiModelSelection(settings, {
      provider: 'anthropic',
      model: anthropicModels[1]!,
    })
    expect(next.provider).toBe('anthropic')
    expect(next.providers.anthropic.apiKey).toBe('k')
    expect(aiModelPickerSelection(next)).toEqual({
      provider: 'anthropic',
      model: anthropicModels[1],
    })
    expect(settings.providers.anthropic.model).toBe(anthropicModels[0])
  })

  it('falls back to uniAI when the stored provider is unusable', () => {
    const settings = defaultAiSettings()
    settings.provider = 'anthropic'
    expect(aiModelPickerSelection(settings).provider).toBe('genspark')
  })
})

describe('CLI vendors', () => {
  it('lists Codex only after the settings page stored a path or model', () => {
    const settings = defaultAiSettings()
    expect(aiModelPickerGroups(settings, false)).toEqual([])
    settings.providers.codex = { apiKey: '', model: '', cliPath: '/usr/local/bin/codex' }
    expect(aiModelPickerGroups(settings, false)).toEqual([
      { id: 'codex', label: 'Codex CLI', models: [] },
    ])
  })
})
