import { describe, expect, it } from 'vitest'
import { uniworkErrorForEntry } from '../src/strings-ai-uniwork'

// The transport stores the S9 key on the chat entry when it picks the message (RF6-3): the result
// chip reads the stored key, never the localized text, so the old text→key reverse lookup (and its
// uniqueness / no-{param} guards) is gone. What remains is the mapping a panel hands `resultChip`.

describe('uniworkErrorForEntry', () => {
  it('prefers the stored key over the text', () => {
    expect(uniworkErrorForEntry('aiErrCredits', 'whatever the renderer wrote')).toEqual({
      code: 'aiErrCredits',
    })
  })

  it('keeps a refusal key so the panel can key the no-retry rule', () => {
    expect(uniworkErrorForEntry('aiErrQuestionTooLong', '')).toEqual({
      code: 'aiErrQuestionTooLong',
    })
  })

  it('falls back to the error text when no key was stored (non-UniWork failure)', () => {
    expect(uniworkErrorForEntry(undefined, 'Network error')).toBe('Network error')
    expect(uniworkErrorForEntry(null, 'boom')).toBe('boom')
  })

  it('is null when there is neither key nor text', () => {
    expect(uniworkErrorForEntry(undefined, undefined)).toBeNull()
    expect(uniworkErrorForEntry(undefined, '')).toBeNull()
    expect(uniworkErrorForEntry(undefined, '   ')).toBeNull()
  })
})
