import { describe, expect, it } from 'vitest'
import { isAgentIntentUrl, parseAgentIntentUrl } from '../src/main/agent-intent-host'

describe('agent-intent-host', () => {
  it('parses uniwork://agent/intent deep links', () => {
    const raw =
      'uniwork://agent/intent?tab=tasks&action=add_item&text=Mua%20sua&summary=Them%20viec&source=pwa'
    expect(isAgentIntentUrl(raw)).toBe(true)
    const parsed = parseAgentIntentUrl(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.intent.target).toEqual({ kind: 'module', id: 'tasks' })
    expect(parsed.intent.action).toBe('add_item')
    expect(parsed.intent.text).toBe('Mua sua')
    expect(parsed.intent.requireConsent).toBe(true)
  })

  it('rejects forbidden query keys and office paths', () => {
    expect(parseAgentIntentUrl('uniwork://office/open?token=abcdefghijklmnop').ok).toBe(false)
    expect(
      parseAgentIntentUrl('uniwork://agent/intent?tab=tasks&jwt=abc.def.ghi').ok,
    ).toBe(false)
    expect(parseAgentIntentUrl('https://example.com/agent/intent?tab=tasks').ok).toBe(false)
  })
})
