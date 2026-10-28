// The Sheets agent's readiness gate: a key saved on UniWork (an org source) counts, an empty slot does not.
import { describe, expect, it } from 'vitest'
import { defaultAiSettings } from '@genoffice/ai-provider'

import { agentConfigured } from '../src/renderer/ai/agent-configured'

const anthropicSlot = () => {
  const s = defaultAiSettings()
  s.provider = 'anthropic'
  s.providers.anthropic = { ...s.providers.anthropic, apiKey: '', model: 'claude-slot' }
  return s
}

describe('agentConfigured', () => {
  it('needs a key in the slot for a local provider', () => {
    const s = anthropicSlot()
    expect(agentConfigured(s, false)).toBe(false)
    s.providers.anthropic = { ...s.providers.anthropic, apiKey: 'sk-test' }
    expect(agentConfigured(s, false)).toBe(true)
    expect(agentConfigured(null, false)).toBe(false)
  })

  it('is ready for a provider served by a key saved on UniWork', () => {
    const s = anthropicSlot()
    s.modelSources = { anthropic: { origin: 'org', chosen: 'claude-org' } }
    expect(agentConfigured(s, false)).toBe(true)
  })

  it('is ready in the web frame, whose keys stay in UniWork, once a model is set', () => {
    expect(agentConfigured(anthropicSlot(), true)).toBe(true)
  })

  it('is ready on UniWork AI, which has no key and no model choice here (UNI-2264)', () => {
    const s = defaultAiSettings()
    s.provider = 'uniwork'
    s.providers.uniwork = { apiKey: '…', model: '' }
    expect(agentConfigured(s, false)).toBe(true)
    expect(agentConfigured(s, true)).toBe(true)
  })
})
