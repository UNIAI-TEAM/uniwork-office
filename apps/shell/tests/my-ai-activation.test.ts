import { describe, expect, it } from 'vitest'
import {
  aiSettingsReady,
  buyAiPlanLabel,
  looksLikeMissingAiActivation,
  softAiActivationMessage,
} from '../src/renderer/src/my-ai-activation'
import { defaultAiSettings } from '@genoffice/ai-provider'

describe('my-ai-activation', () => {
  it('treats default empty genspark install as not ready', () => {
    expect(aiSettingsReady(defaultAiSettings())).toBe(false)
  })

  it('is ready when UniAI Token Hub key is set', () => {
    const s = defaultAiSettings()
    s.providers.genspark = { ...s.providers.genspark, apiKey: 'sk-or-test' }
    expect(aiSettingsReady(s)).toBe(true)
  })

  it('is ready when only openrouter key is set (shared hub)', () => {
    const s = defaultAiSettings()
    s.providers.openrouter = { ...s.providers.openrouter, apiKey: 'sk-or-hub' }
    expect(aiSettingsReady(s)).toBe(true)
  })

  it('matches soft / legacy no-key errors', () => {
    expect(looksLikeMissingAiActivation('No API key configured for genspark')).toBe(true)
    expect(
      looksLikeMissingAiActivation('Chưa kích hoạt / mua gói AI. Hãy mua gói để dùng Trợ lý AI.'),
    ).toBe(true)
    expect(looksLikeMissingAiActivation('Network timeout')).toBe(false)
  })

  it('returns soft copy + CTA labels', () => {
    expect(softAiActivationMessage(true)).toContain('Chưa kích hoạt')
    expect(softAiActivationMessage(false)).toContain('not activated')
    expect(buyAiPlanLabel(true)).toBe('Mua gói AI')
    expect(buyAiPlanLabel(false)).toBe('Buy AI plan')
  })
})
