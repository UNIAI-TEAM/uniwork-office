import { describe, expect, it } from 'vitest'
import { savesAsConvertedCopy } from '../src/renderer/file-actions'

type Doc = Parameters<typeof savesAsConvertedCopy>[0]

const converted = { suggestSaveAs: '/home/me/Memo.docx' } as unknown as Doc
const ordinary = {} as unknown as Doc

describe('Save of a converted legacy .doc', () => {
  it('an explicit Save becomes a Save As next to the original', () => {
    expect(savesAsConvertedCopy(converted, false, false, undefined)).toBe(true)
  })

  it('AutoSave writes the temp copy in place', () => {
    expect(savesAsConvertedCopy(converted, true, false, undefined)).toBe(false)
  })

  it("the shell's flush for the UniWork first save writes in place, no dialog (R1-2)", () => {
    expect(savesAsConvertedCopy(converted, false, true, undefined)).toBe(false)
  })

  it('an MCP explicit target keeps its own path', () => {
    expect(
      savesAsConvertedCopy(converted, false, false, { path: '/x/out.docx', overwrite: true }),
    ).toBe(false)
  })

  it('an ordinary document, or no document, is never redirected', () => {
    expect(savesAsConvertedCopy(ordinary, false, false, undefined)).toBe(false)
    expect(savesAsConvertedCopy(null, false, false, undefined)).toBe(false)
  })
})
