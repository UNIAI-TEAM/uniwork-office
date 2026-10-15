import { describe, expect, it } from 'vitest'
import { aiEffectiveModel, defaultAiSettings } from '../src/index'

describe('aiEffectiveModel', () => {
  it('reads the source chosen model before the slot model (an org-served provider)', () => {
    const settings = defaultAiSettings()
    settings.providers.anthropic.model = 'claude-sonnet-5'
    settings.modelSources = { anthropic: { chosen: 'claude-opus-4-7', origin: 'org' } }
    expect(aiEffectiveModel(settings, 'anthropic')).toBe('claude-opus-4-7')
  })

  it('falls back to the slot model without a source or with an empty chosen model', () => {
    const settings = defaultAiSettings()
    settings.providers.anthropic.model = 'claude-sonnet-5'
    expect(aiEffectiveModel(settings, 'anthropic')).toBe('claude-sonnet-5')
    settings.modelSources = { anthropic: { chosen: '  ', origin: 'org' } }
    expect(aiEffectiveModel(settings, 'anthropic')).toBe('claude-sonnet-5')
  })

  it('is empty for a provider with neither', () => {
    expect(aiEffectiveModel({ providers: {} as never }, 'openai')).toBe('')
  })

  it('does not take the source of another provider', () => {
    const settings = defaultAiSettings()
    settings.providers.openai.model = 'gpt-local'
    settings.modelSources = { anthropic: { chosen: 'claude-opus-4-7', origin: 'org' } }
    expect(aiEffectiveModel(settings, 'openai')).toBe('gpt-local')
  })
})
