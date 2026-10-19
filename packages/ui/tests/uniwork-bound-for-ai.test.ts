// UNI-1919 (w2): the one rule every app's AI layer reads for "this document
// is UniWork-bound". The adapter's `bound` answer keeps working-copy meaning
// (web save, comments, the Save button key off it), while a web frame IS the
// UniWork document, so the AI must read it as bound. The platform value is
// the capability reader's `platform()` ('web' in a frame, undefined on the
// desktop, where the adapter answer is passed through verbatim).
import { describe, expect, it } from 'vitest'
import { uniworkBoundForAi } from '../src/capabilities'

describe('uniworkBoundForAi: the bound answer the AI layer reads', () => {
  it('a web frame reads as bound even when the adapter says bound: false', () => {
    expect(uniworkBoundForAi(false, 'web')).toBe(true)
    expect(uniworkBoundForAi(true, 'web')).toBe(true)
  })

  it('desktop (no capabilities object) keeps the adapter answer verbatim', () => {
    expect(uniworkBoundForAi(false, undefined)).toBe(false)
    expect(uniworkBoundForAi(true, undefined)).toBe(true)
  })

  it('a desktop platform marker keeps the adapter answer verbatim too', () => {
    expect(uniworkBoundForAi(false, 'desktop')).toBe(false)
    expect(uniworkBoundForAi(true, 'desktop')).toBe(true)
  })
})
