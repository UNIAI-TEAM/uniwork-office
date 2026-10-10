import { describe, expect, it } from 'vitest'
import { drainedOrigin, forcesBoundSave } from '../src/renderer/uniwork-save'
import {
  PDF_UNIWORK_AUTOSAVE_OFF,
  PDF_UNIWORK_VIEW_ONLY,
  isUniworkRefusal,
} from '../src/shared/uniwork-refusal'

const base = {
  origin: 'user' as const,
  bound: true,
  readOnly: false,
  pendingRedactions: 0,
  afterUserSave: false,
}

describe('forcesBoundSave', () => {
  it('forces an explicit Save of a bound editable document even when clean', () => {
    expect(forcesBoundSave(base)).toBe(true)
  })

  it('does not force a Save queued behind a user Save that just wrote (one click, one report)', () => {
    expect(forcesBoundSave({ ...base, afterUserSave: true })).toBe(false)
  })

  it.each([
    ['autosave', { origin: 'auto' as const }],
    ['an internal flush', { origin: 'internal' as const }],
    ['a plain local file', { bound: false }],
    ['a view-only copy', { readOnly: true }],
    ['pending redactions', { pendingRedactions: 1 }],
  ])('never forces %s', (_name, patch) => {
    expect(forcesBoundSave({ ...base, ...patch })).toBe(false)
  })
})

describe('drainedOrigin', () => {
  it('one explicit request makes the batch explicit', () => {
    expect(drainedOrigin(['auto', 'user'])).toBe('user')
    expect(drainedOrigin(['internal', 'user'])).toBe('user')
  })
  it('keeps an all-autosave batch silent and mixed internal work internal', () => {
    expect(drainedOrigin(['auto', 'auto'])).toBe('auto')
    expect(drainedOrigin(['auto', 'internal'])).toBe('internal')
  })
})

describe('isUniworkRefusal', () => {
  it('recognises main declining a view-only or autosave write, nothing else', () => {
    expect(isUniworkRefusal(PDF_UNIWORK_VIEW_ONLY)).toBe(true)
    expect(isUniworkRefusal(PDF_UNIWORK_AUTOSAVE_OFF)).toBe(true)
    expect(isUniworkRefusal('EACCES: permission denied')).toBe(false)
    expect(isUniworkRefusal(undefined)).toBe(false)
  })
})
