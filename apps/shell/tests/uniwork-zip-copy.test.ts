import { describe, expect, it } from 'vitest'
import {
  RESULT_LINES_MAX,
  errorKeyOf,
  resultSummary,
} from '../src/renderer/src/uniwork-zip-download/copy'
import { uniworkDocListStrings } from '../src/renderer/src/i18n/strings-uniwork-doclist'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'
import type { ZipDownloadErrorCode } from '../src/shared/zip-download-api'

const tFor = (lang: 'vi' | 'en') => {
  const dict = { ...uniworkShareStrings[lang], ...uniworkDocListStrings[lang] } as Record<
    string,
    string
  >
  return (key: string, params?: Record<string, string | number>) =>
    (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`))
}

describe('zip result copy (UNI-2068 ZB)', () => {
  it('lists at most 5 "title: reason" lines, then "and N more"', () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({
      documentId: `d${i}`,
      title: `T${i}`,
      reason: 'not_a_file' as const,
    }))
    const out = resultSummary(tFor('en') as never, { ok: 3, total: 11, lines })
    expect(RESULT_LINES_MAX).toBe(5)
    expect(out.headline).toBe('Downloaded 3/11 documents')
    expect(out.lines).toHaveLength(5)
    expect(out.lines[0]).toBe('T0: cannot be downloaded (not a file)')
    expect(out.more).toBe('and 3 more documents')
  })

  it('says "more document" for exactly one left, and nothing for five or fewer', () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        documentId: `d${i}`,
        title: `T${i}`,
        reason: 'not_found' as const,
      }))
    expect(resultSummary(tFor('en') as never, { ok: 1, total: 7, lines: mk(6) }).more).toBe(
      'and 1 more document',
    )
    expect(resultSummary(tFor('en') as never, { ok: 1, total: 6, lines: mk(5) }).more).toBeNull()
    expect(resultSummary(tFor('en') as never, { ok: 2, total: 2, lines: [] })).toEqual({
      headline: 'Downloaded 2/2 documents',
      lines: [],
      parts: [],
      more: null,
    })
  })

  it('an untitled row falls back to "Untitled"', () => {
    const out = resultSummary(tFor('en') as never, {
      ok: 0,
      total: 1,
      lines: [{ documentId: 'x', title: '', reason: 'other_workspace' }],
    })
    expect(out.lines[0]).toMatch(/^Untitled: /)
  })

  it('vi carries the web copy verbatim', () => {
    const out = resultSummary(tFor('vi') as never, {
      ok: 1,
      total: 3,
      lines: [{ documentId: 'a', title: 'A', reason: 'zip_limit' }],
    })
    expect(out.headline).toBe('Đã tải xuống 1/3 tài liệu')
    expect(out.lines[0]).toBe('A: quá 100 tệp của một tệp nén, hãy tải ở lượt khác')
  })

  it('every error code has a message key, the web wording for the four it knows', () => {
    const codes: ZipDownloadErrorCode[] = [
      'zip_too_large',
      'zip_expired',
      'zip_busy',
      'zip_failed',
      'zip_timeout',
      'zip_unavailable',
      'forbidden_target',
      'write_failed',
      'canceled',
      'too_large',
      'server_error',
      'network',
      'signed_out',
    ]
    const en = uniworkDocListStrings.en as Record<string, string>
    for (const code of codes) expect(en[errorKeyOf(code)]).toBeTruthy()
    expect(en[errorKeyOf('zip_too_large')]).toBe(
      'The selected files add up to more than 1 GB. Choose fewer files.',
    )
    expect(en[errorKeyOf('zip_expired')]).toBe('The download link has expired. Try again.')
    expect(en[errorKeyOf('zip_timeout')]).toBe('The zip file is not ready yet. Try again later.')
    expect(en[errorKeyOf('network')]).toBe('The zip file could not be made. Try again.')
  })
})
