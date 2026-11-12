import { describe, expect, it } from 'vitest'
import { isEditorSessionId, newEditorSessionId } from '../src/main/uniwork-docs/editor-session-id'

describe('UNI-2510 editor session id', () => {
  it('mints a strict ULID the server accepts, a different one each time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newEditorSessionId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(isEditorSessionId(id)).toBe(true)
  })

  it('encodes the time in the first 10 characters and sorts by it', () => {
    const zero = () => new Uint8Array(16)
    expect(newEditorSessionId(0, zero)).toBe('0000000000' + '0'.repeat(16))
    expect(newEditorSessionId(32, zero).slice(0, 10)).toBe('0000000010')
    expect(
      newEditorSessionId(1_762_900_000_000, zero) > newEditorSessionId(1_700_000_000_000, zero),
    ).toBe(true)
  })

  it('refuses what the server would answer with invalid_editor_session_id', () => {
    for (const bad of [
      '',
      'short',
      '01ARZ3NDEKTSV4RRFFQ69G5FAVX', // 27 characters
      '81ARZ3NDEKTSV4RRFFQ69G5FAV', // time part overflows 48 bits
      '01ARZ3NDEKTSV4RRFFQ69G5FAU', // U is not Crockford base32
      undefined,
      12,
    ]) {
      expect(isEditorSessionId(bad)).toBe(false)
    }
  })
})
