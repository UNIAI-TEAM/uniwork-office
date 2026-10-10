import { describe, expect, it, vi } from 'vitest'
import { PLAIN_PDF_STATE, queryPdfUniworkState } from '../src/renderer/uniwork-state'

describe('queryPdfUniworkState', () => {
  it('returns main’s answer for the path', async () => {
    const uniworkState = vi.fn(async () => ({ bound: true, readOnly: true }))
    await expect(queryPdfUniworkState({ uniworkState }, '/a.pdf')).resolves.toEqual({
      bound: true,
      readOnly: true,
    })
    expect(uniworkState).toHaveBeenCalledWith('/a.pdf')
  })

  it('reads a missing method (browser harness) as an unbound, editable file', async () => {
    await expect(queryPdfUniworkState({}, '/a.pdf')).resolves.toEqual(PLAIN_PDF_STATE)
    expect(PLAIN_PDF_STATE).toEqual({ bound: false, readOnly: false })
  })

  it('reads a rejected call as an unbound, editable file', async () => {
    const uniworkState = vi.fn(async () => {
      throw new Error('no handler')
    })
    await expect(queryPdfUniworkState({ uniworkState }, '/a.pdf')).resolves.toEqual(PLAIN_PDF_STATE)
  })

  it('treats a malformed answer as not bound and not read only', async () => {
    const uniworkState = vi.fn(async () => undefined as never)
    await expect(queryPdfUniworkState({ uniworkState }, '/a.pdf')).resolves.toEqual(PLAIN_PDF_STATE)
  })
})
