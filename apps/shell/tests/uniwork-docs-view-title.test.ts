/**
 * UNI-2033: a read-only copy of an older version (`<documentId>@vN/` working-copy
 * folder) says so in its tab / window title: "Plan.docx · phiên bản 2, chỉ đọc".
 * The long sentence of the comments kit (`collabVersionViewBanner`) does not fit a
 * title, so the shell has its own short form.
 */
import { describe, expect, it } from 'vitest'
import { UNIWORK_DOC_STRINGS, tUniworkDocs } from '../src/main/uniwork-docs/strings'
import { viewVersionOfPath, withViewVersionTitle } from '../src/main/uniwork-docs/view-title'

const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const inStore = (path: string) => path.startsWith('/home/u/store/')
const copy = (key: string) => `/home/u/store/default/acc_1/${key}/Q4 plan.docx`

describe('viewVersionOfPath', () => {
  it('reads N from the @vN working-copy folder', () => {
    expect(viewVersionOfPath(copy(`${DOC}@v2`))).toBe(2)
    expect(viewVersionOfPath(copy(`${DOC}@v13`))).toBe(13)
    expect(viewVersionOfPath(`C:\\store\\default\\acc_1\\${DOC}@v7\\Q4 plan.docx`)).toBe(7)
  })

  it('is null for a head copy, a plain file and anything that is not a positive integer', () => {
    expect(viewVersionOfPath(copy(DOC))).toBeNull()
    expect(viewVersionOfPath('/home/u/Documents/Plan.docx')).toBeNull()
    expect(viewVersionOfPath(copy(`${DOC}@v0`))).toBeNull()
    expect(viewVersionOfPath(copy(`${DOC}@v-1`))).toBeNull()
    expect(viewVersionOfPath(copy(`${DOC}@v1.5`))).toBeNull()
    expect(viewVersionOfPath(copy(`${DOC}@vx`))).toBeNull()
    expect(viewVersionOfPath(copy(`${DOC}@v2x`))).toBeNull()
    expect(viewVersionOfPath('')).toBeNull()
  })

  it('looks at the folder only: a file named like a version copy is not one', () => {
    expect(viewVersionOfPath('/home/u/Documents/Plan@v2.docx')).toBeNull()
    expect(viewVersionOfPath(`/home/u/${DOC}@v2/nested/Plan.docx`)).toBeNull()
  })
})

describe('withViewVersionTitle', () => {
  it('appends the short read-only form for a version copy, in the UI language', () => {
    const path = copy(`${DOC}@v2`)
    expect(withViewVersionTitle('Q4 plan.docx', path, 'vi', inStore)).toBe(
      'Q4 plan.docx · phiên bản 2, chỉ đọc',
    )
    expect(withViewVersionTitle('Q4 plan.docx', path, 'en', inStore)).toBe(
      'Q4 plan.docx · version 2, read-only',
    )
    // every other UI language reads English, like the other shell dialogs
    expect(withViewVersionTitle('Q4 plan.docx', path, 'zh', inStore)).toBe(
      'Q4 plan.docx · version 2, read-only',
    )
  })

  it('leaves every other title alone', () => {
    expect(withViewVersionTitle('Q4 plan.docx', copy(DOC), 'vi', inStore)).toBe('Q4 plan.docx')
    expect(withViewVersionTitle('Untitled', undefined, 'vi', inStore)).toBe('Untitled')
    expect(withViewVersionTitle('UniWork Office', '', 'en', inStore)).toBe('UniWork Office')
  })

  it('suffixes only paths inside the store: a plain @v2 folder elsewhere stays plain', () => {
    const outside = '/home/u/work/report@v2/Plan.docx'
    expect(withViewVersionTitle('Plan.docx', outside, 'en', inStore)).toBe('Plan.docx')
    expect(withViewVersionTitle('Plan.docx', copy(`${DOC}@v2`), 'en', inStore)).toBe(
      'Plan.docx · version 2, read-only',
    )
  })

  it('is idempotent: a title that already carries the suffix is not suffixed twice', () => {
    const path = copy(`${DOC}@v2`)
    const once = withViewVersionTitle('Q4 plan.docx', path, 'vi', inStore)
    expect(withViewVersionTitle(once, path, 'vi', inStore)).toBe(once)
  })
})

describe('the shell string', () => {
  it('has a vi and an en text with the {version} slot', () => {
    expect(UNIWORK_DOC_STRINGS.vi.viewVersionSuffix).toBe('phiên bản {version}, chỉ đọc')
    expect(UNIWORK_DOC_STRINGS.en.viewVersionSuffix).toBe('version {version}, read-only')
    expect(tUniworkDocs('vi', 'viewVersionSuffix', { version: 5 })).toBe('phiên bản 5, chỉ đọc')
  })
})
