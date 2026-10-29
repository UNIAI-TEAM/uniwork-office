// The Sheets agent's readiness gate: UniWork AI is ready as it is; any other provider needs a model
// and, except the built-in UniAI, a key in its slot (UNI-2289: no key reaches a web frame).
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
  it('is ready on UniWork AI, which has no key and no model choice here (UNI-2264)', () => {
    const s = defaultAiSettings()
    s.provider = 'uniwork'
    s.providers.uniwork = { apiKey: '…', model: '' }
    expect(agentConfigured(s)).toBe(true)
  })

  it('a provider with a model but no key in its slot is not ready (what a web frame holds)', () => {
    expect(agentConfigured(anthropicSlot())).toBe(false)
  })

  it('a key saved on UniWork no longer serves a provider', () => {
    const s = anthropicSlot()
    s.modelSources = { anthropic: { origin: 'org', chosen: 'claude-org' } }
    expect(agentConfigured(s)).toBe(false)
  })

  it('needs a key in the slot for a local provider', () => {
    const s = anthropicSlot()
    s.providers.anthropic = { ...s.providers.anthropic, apiKey: 'sk-test' }
    expect(agentConfigured(s)).toBe(true)
    expect(agentConfigured(null)).toBe(false)
  })
})
