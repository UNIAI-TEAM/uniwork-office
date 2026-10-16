import { describe, expect, it } from 'vitest'
import { OPEN_DIALOG_EXTENSIONS } from '../src/shared/open-extensions'

/**
 * FD-14: the File > Open filter list moved to shared so the renderer can read
 * it too (the Home hint). It stays a pure list of the formats UniWork Office
 * routes - the legacy .doc/.ppt binaries are in on purpose - with no duplicate
 * and no all-files "*" an importer could inherit.
 */
describe('the shared open-dialog extensions', () => {
  it('lists each extension once, with no all-files entry', () => {
    expect(OPEN_DIALOG_EXTENSIONS).toHaveLength(16)
    expect(new Set(OPEN_DIALOG_EXTENSIONS).size).toBe(16)
    expect(OPEN_DIALOG_EXTENSIONS).not.toContain('*')
  })
})
