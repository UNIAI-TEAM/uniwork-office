import { describe, expect, it, vi } from 'vitest'
import {
  drainedOrigin,
  forcesBoundSave,
  pdfExplainReadOnlySave,
} from '../src/renderer/uniwork-save'
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

describe('pdfExplainReadOnlySave', () => {
  const PATH = 'C:/u/uniwork-documents/dep/user/doc1/spec.pdf'
  const view = { origin: 'user' as const, bound: true, readOnly: true, filePath: PATH }

  it('calls uniworkReadOnlySave once and returns true for an explicit Save on a read-only bound PDF', () => {
    const uniworkReadOnlySave = vi.fn(async () => undefined)
    expect(pdfExplainReadOnlySave({ uniworkReadOnlySave }, view)).toBe(true)
    expect(uniworkReadOnlySave).toHaveBeenCalledTimes(1)
    expect(uniworkReadOnlySave).toHaveBeenCalledWith(PATH)
  })

  it.each([
    ['editable bound', { readOnly: false }],
    ['unbound read-only', { bound: false }],
    ['autosave', { origin: 'auto' as const }],
    ['internal flush', { origin: 'internal' as const }],
    ['no path', { filePath: null }],
  ])('returns false and does not call the seam for %s', (_label, patch) => {
    const uniworkReadOnlySave = vi.fn(async () => undefined)
    expect(pdfExplainReadOnlySave({ uniworkReadOnlySave }, { ...view, ...patch })).toBe(false)
    expect(uniworkReadOnlySave).not.toHaveBeenCalled()
  })

  it('still blocks the write when the seam is absent', () => {
    expect(pdfExplainReadOnlySave({}, view)).toBe(true)
    expect(pdfExplainReadOnlySave(undefined, view)).toBe(true)
  })
})
