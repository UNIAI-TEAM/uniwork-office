import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DRAFT_PREVIEW_DIR, isDraftPreviewPath } from '../src/draft-preview'

const USER_DATA = join('/', 'tmp', 'uw-user-data')

describe('isDraftPreviewPath', () => {
  it('is true for a file inside the preview root, at any depth', () => {
    expect(isDraftPreviewPath(USER_DATA, join(USER_DATA, DRAFT_PREVIEW_DIR, 's1', 'a.docx'))).toBe(
      true,
    )
    expect(
      isDraftPreviewPath(USER_DATA, join(USER_DATA, DRAFT_PREVIEW_DIR, 's1', 'd2', 'a.xlsx')),
    ).toBe(true)
  })

  it('is false for the root itself, siblings that share the prefix, and normal documents', () => {
    expect(isDraftPreviewPath(USER_DATA, join(USER_DATA, DRAFT_PREVIEW_DIR))).toBe(false)
    expect(isDraftPreviewPath(USER_DATA, join(USER_DATA, `${DRAFT_PREVIEW_DIR}-x`, 'a.docx'))).toBe(
      false,
    )
    expect(isDraftPreviewPath(USER_DATA, join(USER_DATA, 'a.docx'))).toBe(false)
    expect(isDraftPreviewPath(USER_DATA, join('/', 'home', 'u', 'Documents', 'a.docx'))).toBe(false)
  })
})
