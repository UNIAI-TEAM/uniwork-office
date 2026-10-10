// The text of a failed save: translated for every protocol code and HTTP status, never the raw
// English status line ("Internal Server Error", "Forbidden") of the host in any locale.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROTOCOL_ERROR_CODES, type ProtocolErrorCode } from '../../docs/protocol/types'
import { setWebLanguage } from '../../docs/bridge/browser'
import { saveFailureDetail, saveFailureKey, saveFailureText } from './save-failure'
import { webStrings } from './i18n/strings-web'

const translate = (key: 'webSaveNetwork' | 'webSaveTimeout'): string => `module:${key}`

// the host language is module state: pin en before and after each case
beforeEach(() => setWebLanguage('en', { host: true }))
afterEach(() => setWebLanguage('en', { host: true }))

describe('saveFailureKey', () => {
  it.each([
    ['unauthorized', undefined, 'webSaveUnauthorized'],
    ['forbidden', 403, 'webSaveForbidden'],
    ['not_found', 404, 'webSaveNotFound'],
    ['too_large', 413, 'webSaveTooLarge'],
    ['rate_limited', 429, 'webSaveRateLimited'],
    ['conflict', undefined, 'webConflictNotSaved'],
    ['conflict', 409, 'webConflictNotSaved'],
    ['internal', 409, 'webConflictNotSaved'],
    ['internal', 412, 'webConflictNotSaved'],
    ['internal', 500, 'webSaveServer'],
    ['internal', 503, 'webSaveServer'],
    ['internal', 410, 'webSaveNotFound'],
    ['internal', undefined, 'webSaveFailedGeneric'],
    ['internal', 418, 'webSaveFailedGeneric'],
    ['busy', undefined, 'webSaveFailedGeneric'],
    ['unsupported', undefined, 'webSaveFailedGeneric'],
  ] as const)('%s (status %s) -> %s', (code, status, key) => {
    expect(saveFailureKey({ code, message: 'x', ...(status ? { status } : {}) })).toBe(key)
  })

  it('maps every protocol code to a key that exists in every locale', () => {
    const keys = new Set(Object.keys(webStrings.zh))
    for (const code of PROTOCOL_ERROR_CODES as readonly ProtocolErrorCode[]) {
      expect(keys.has(saveFailureKey({ code, message: 'Internal Server Error' })), code).toBe(true)
    }
  })
})

describe('saveFailureText', () => {
  it('keeps the module sentence for a timeout or a network failure', () => {
    expect(saveFailureText({ code: 'timeout', message: 'save timed out' }, translate)).toBe(
      'module:webSaveTimeout',
    )
    expect(saveFailureText({ code: 'network', message: 'Failed to fetch' }, translate)).toBe(
      'module:webSaveNetwork',
    )
  })

  it('never shows the raw status text, in en or vi', () => {
    const raw = { code: 'internal', message: 'Internal Server Error', status: 500 } as const
    expect(saveFailureText(raw, translate)).toBe(
      'UniWork had a problem saving. Try again in a moment.',
    )
    setWebLanguage('vi', { host: true })
    const vi = saveFailureText(raw, translate)
    expect(vi).toBe('UniWork gặp sự cố khi lưu. Hãy thử lại sau ít phút.')
    for (const message of ['Forbidden', 'Not Found', 'Payload Too Large', 'Unauthorized', 'Gone']) {
      expect(saveFailureText({ code: 'internal', message }, translate)).not.toContain(message)
    }
  })

  it('a conflict says the document changed elsewhere, in the page language, with no retry hint', () => {
    const conflict = { code: 'conflict', message: 'stale etag (HTTP 409)', status: 409 } as const
    expect(saveFailureText(conflict, translate)).toBe('the document was changed elsewhere')
    expect(saveFailureText(conflict, translate)).not.toMatch(/try again|stale etag|409/i)
    setWebLanguage('vi', { host: true })
    expect(saveFailureText(conflict, translate)).toBe('tài liệu đã được thay đổi ở nơi khác')
  })

  it('maps each status family to its own sentence in vi', () => {
    setWebLanguage('vi', { host: true })
    expect(
      saveFailureText({ code: 'forbidden', message: 'Forbidden', status: 403 }, translate),
    ).toBe('Bạn không có quyền lưu tài liệu này.')
    expect(saveFailureText({ code: 'too_large', message: 'Payload Too Large' }, translate)).toBe(
      'Tài liệu quá lớn để lưu.',
    )
    expect(saveFailureText({ code: 'internal', message: 'Gone', status: 410 }, translate)).toBe(
      'Tài liệu này không còn tồn tại hoặc đã được di chuyển.',
    )
  })
})

describe('saveFailureDetail', () => {
  it('is the localized sentence for a status failure and null for a transport failure', () => {
    expect(
      saveFailureDetail({ code: 'internal', message: 'Internal Server Error', status: 500 }),
    ).toBe('UniWork had a problem saving. Try again in a moment.')
    expect(saveFailureDetail({ code: 'network', message: 'Failed to fetch' })).toBeNull()
    expect(saveFailureDetail({ code: 'timeout', message: 'x' })).toBeNull()
  })
})
