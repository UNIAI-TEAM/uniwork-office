import { describe, expect, it } from 'vitest'
import { aiTestFailureKindForStatus, aiTestFailureKindForText } from '../src/ai-test-failure'

describe('AI failure kinds', () => {
  it('maps an HTTP status onto its kind', () => {
    expect(aiTestFailureKindForStatus(403)).toBe('invalid_key')
    expect(aiTestFailureKindForStatus(401)).toBe('invalid_key')
    expect(aiTestFailureKindForStatus(402)).toBe('limit')
    expect(aiTestFailureKindForStatus(429)).toBe('limit')
    expect(aiTestFailureKindForStatus(503)).toBe('unavailable')
    expect(aiTestFailureKindForStatus(400)).toBe('failed')
  })

  it('classifies raw text by its status or its transport failure', () => {
    expect(aiTestFailureKindForText('HTTP 403: { "error": {} }')).toBe('invalid_key')
    expect(aiTestFailureKindForText('fetch failed cause=ECONNRESET')).toBe('network')
    const abort = new Error('The operation was aborted due to timeout')
    abort.name = 'TimeoutError'
    expect(aiTestFailureKindForText('', abort)).toBe('network')
    expect(aiTestFailureKindForText('Something odd')).toBe('failed')
  })
})
