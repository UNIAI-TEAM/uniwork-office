import { describe, expect, it } from 'vitest'
import {
  aiSettingsReady,
  looksLikeMissingAiActivation,
  openAiSettingsLabel,
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

  it('matches soft / legacy no-key errors and the product notices', () => {
    expect(looksLikeMissingAiActivation('No API key configured for genspark')).toBe(true)
    for (const vi of [true, false]) {
      for (const state of ['signed-out', 'not-entitled', 'credits-exhausted'] as const) {
        expect(looksLikeMissingAiActivation(softAiActivationMessage(vi, state))).toBe(true)
      }
    }
    expect(looksLikeMissingAiActivation('Network timeout')).toBe(false)
  })

  it('returns soft copy that follows the organization plan, with no purchase wording', () => {
    expect(softAiActivationMessage(true)).toContain('Chưa thiết lập mô hình AI')
    expect(softAiActivationMessage(false)).toContain('No AI model is set up')
    expect(softAiActivationMessage(false, 'ready')).toContain('No AI model is set up')
    expect(softAiActivationMessage(false, 'not-entitled')).toContain("organization's plan")
    expect(softAiActivationMessage(true, 'not-entitled')).toContain('Gói của tổ chức')
    expect(softAiActivationMessage(false, 'credits-exhausted')).toContain('AI credits')
    expect(softAiActivationMessage(true, 'credits-exhausted')).toContain('tín dụng AI')
    for (const vi of [true, false]) {
      expect(softAiActivationMessage(vi, 'not-entitled')).not.toMatch(/purchase|buy|mua gói/i)
    }
    expect(openAiSettingsLabel(true)).toBe('Mở cài đặt AI')
    expect(openAiSettingsLabel(false)).toBe('Open AI settings')
  })
})
