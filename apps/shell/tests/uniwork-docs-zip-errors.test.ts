import { describe, expect, it } from 'vitest'
import { errorFromResponse } from '../src/main/uniwork-docs/errors'

const envelope = (code: string, fields?: Record<string, unknown>) => ({
  error: { code, message: 'x', ...(fields ? { fields } : {}) },
})

describe('errorFromResponse: document download jobs (UNI-2068)', () => {
  it('maps 410 document_download_expired to the zip_expired verdict, not to deleted', () => {
    const error = errorFromResponse(410, envelope('document_download_expired'))
    expect(error.code).toBe('server_error')
    expect(error.zip).toBe('zip_expired')
    expect(error.serverCode).toBe('document_download_expired')
    expect(error.status).toBe(410)
  })

  it('still reads any other coded 410 as deleted', () => {
    const error = errorFromResponse(410, envelope('document_gone'))
    expect(error.code).toBe('deleted')
    expect(error.zip).toBeUndefined()
  })

  it('maps 422 download_too_large to zip_too_large and keeps the server cap', () => {
    const error = errorFromResponse(422, envelope('download_too_large', { max_bytes: 1073741824 }))
    expect(error.code).toBe('server_error')
    expect(error.zip).toBe('zip_too_large')
    expect(error.maxBytes).toBe(1073741824)
  })

  it('maps 429 download_jobs_busy to zip_busy and carries the Retry-After', () => {
    const fromHeader = errorFromResponse(429, envelope('download_jobs_busy'), 30_000)
    expect(fromHeader.zip).toBe('zip_busy')
    expect(fromHeader.retryAfterMs).toBe(30_000)
    const fromField = errorFromResponse(429, envelope('download_jobs_busy', { retry_after: 30 }))
    expect(fromField.zip).toBe('zip_busy')
    expect(fromField.retryAfterMs).toBe(30_000)
  })

  it('keeps the general 429 limiter a retryable server_error', () => {
    const error = errorFromResponse(429, envelope('rate_limited'), 5_000)
    expect(error.code).toBe('server_error')
    expect(error.retryAfterMs).toBe(5_000)
  })
})
