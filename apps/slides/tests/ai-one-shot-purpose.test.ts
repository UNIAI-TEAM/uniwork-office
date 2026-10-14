// The panel's in-tool generators (per-page, style skill, planning) call aiStream directly, not
// through the agent loop. With UniWork AI picked, the desktop runner refuses a request marked as
// a one-shot (it is not a conversation turn), so every such request has to carry the mark.
import { describe, expect, it } from 'vitest'
import { oneShotStreamRequest } from '../src/renderer/ai/llm-request'
import type { AiSettings } from '../src/shared/ipc'

const settings = { provider: 'uniwork', providers: {} } as unknown as AiSettings

describe('Slides one-shot stream request', () => {
  it('is marked as a one-shot so UniWork AI refuses it', () => {
    const req = oneShotStreamRequest({ requestId: 'r1', settings, system: 'sys', user: 'page 3' })
    expect(req.purpose).toBe('one-shot')
    expect(req.system).toBe('sys')
    expect(req.messages).toEqual([{ role: 'user', text: 'page 3' }])
    expect(req).not.toHaveProperty('maxTokens')
  })

  it('keeps the output cap when given', () => {
    const req = oneShotStreamRequest({
      requestId: 'r2',
      settings,
      system: 's',
      user: 'u',
      maxTokens: 4096,
    })
    expect(req).toMatchObject({ purpose: 'one-shot', maxTokens: 4096 })
  })
})
