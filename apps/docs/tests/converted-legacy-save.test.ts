import { describe, expect, it } from 'vitest'
import {
  autoSavesDocument,
  canReuseSavePass,
  savesAsConvertedCopy,
} from '../src/renderer/file-actions'

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

describe('AutoSave of a converted legacy .doc (F1)', () => {
  it('never autosaves a converted copy, whatever the preference says', () => {
    expect(autoSavesDocument(true, false, converted)).toBe(false)
    expect(autoSavesDocument(false, false, converted)).toBe(false)
  })

  it('still autosaves an ordinary document, and never a UniWork one', () => {
    expect(autoSavesDocument(true, false, ordinary)).toBe(true)
    expect(autoSavesDocument(true, true, ordinary)).toBe(false)
    expect(autoSavesDocument(false, false, ordinary)).toBe(false)
  })
})

describe('a save waiting behind another pass (R1-8)', () => {
  const idle = {
    saveAs: false,
    inPlace: false,
    explicitTarget: undefined,
    convertedSaveAs: false,
    incomplete: false,
    dirty: false,
  }

  it('reuses a clean finished pass for a plain Save', () => {
    expect(canReuseSavePass(idle)).toBe(true)
  })

  it("the shell's in-place flush runs its own pass even when an AutoSave left the file clean", () => {
    expect(canReuseSavePass({ ...idle, inPlace: true })).toBe(false)
  })

  it('Save As, an MCP target, a converted Save As, an incomplete or dirty pass never reuse', () => {
    expect(canReuseSavePass({ ...idle, saveAs: true })).toBe(false)
    expect(
      canReuseSavePass({ ...idle, explicitTarget: { path: '/x.docx', overwrite: true } }),
    ).toBe(false)
    expect(canReuseSavePass({ ...idle, convertedSaveAs: true })).toBe(false)
    expect(canReuseSavePass({ ...idle, incomplete: true })).toBe(false)
    expect(canReuseSavePass({ ...idle, dirty: true })).toBe(false)
  })
})
