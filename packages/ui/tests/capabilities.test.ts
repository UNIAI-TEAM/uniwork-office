import { describe, expect, it } from 'vitest'
import { createCapabilityReader } from '../src/capabilities'

describe('createCapabilityReader', () => {
  it('desktop (no object): every capability is on', () => {
    const r = createCapabilityReader<'ai' | 'open'>(() => undefined)
    expect(r.cap('ai')).toBe(true)
    expect(r.platform()).toBeUndefined()
  })

  it('web: explicit false hides, missing keys stay on, later grants are seen', () => {
    const caps: Record<string, unknown> = { platform: 'web', ai: false, open: false }
    const r = createCapabilityReader<'ai' | 'open' | 'print'>(() => caps)
    expect(r.cap('ai')).toBe(false)
    expect(r.cap('open')).toBe(false)
    expect(r.cap('print')).toBe(true)
    expect(r.platform()).toBe('web')
    caps.open = true // host grant assigned into the same object after init
    expect(r.cap('open')).toBe(true)
  })

  it('reads once (cached) until resetForTest; a throwing reader means desktop', () => {
    let calls = 0
    let current: Record<string, unknown> | undefined = { ai: false }
    const r = createCapabilityReader<'ai'>(() => {
      calls++
      return current
    })
    r.cap('ai')
    r.cap('ai')
    expect(calls).toBe(1)
    current = undefined
    r.resetForTest()
    expect(r.cap('ai')).toBe(true)
    const broken = createCapabilityReader<'ai'>(() => {
      throw new Error('no window')
    })
    expect(broken.cap('ai')).toBe(true)
  })
})
