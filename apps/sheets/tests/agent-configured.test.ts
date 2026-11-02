// The Sheets agent's readiness gate: only UniWork AI sends, and only while the host offers it
// (UNI-2309). When it is not offered (signed out, offline, the organization without UniWork AI)
// the panel falls back to the fixed planner instead of the agent.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultAiSettings, setUniworkAiAvailable } from '@genoffice/ai-provider'

import { agentConfigured } from '../src/renderer/ai/agent-configured'

afterEach(() => setUniworkAiAvailable(false))

describe('agentConfigured', () => {
  it('is ready on UniWork AI while the host offers it', () => {
    setUniworkAiAvailable(true)
    expect(agentConfigured({ ...defaultAiSettings(), provider: 'uniwork' })).toBe(true)
  })

  it('is not ready on UniWork AI while the host does not offer it', () => {
    setUniworkAiAvailable(false)
    expect(agentConfigured({ ...defaultAiSettings(), provider: 'uniwork' })).toBe(false)
  })

  it('is not ready without settings', () => {
    setUniworkAiAvailable(true)
    expect(agentConfigured(null)).toBe(false)
    expect(agentConfigured(undefined)).toBe(false)
  })
})
