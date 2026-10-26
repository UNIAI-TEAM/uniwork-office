import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { en } from '../src/renderer/i18n/app/en'
import { vi as viStrings } from '../src/renderer/i18n/app/vi'
import {
  autoSaveNeedsFirstSave,
  autoSavesDocument,
  canReuseSavePass,
  save,
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

describe('the AutoSave switch of a converted copy is disabled until the first Save As (F4)', () => {
  it('flags a converted copy, not an ordinary or absent document', () => {
    expect(autoSaveNeedsFirstSave(converted)).toBe(true)
    expect(autoSaveNeedsFirstSave(ordinary)).toBe(false)
    expect(autoSaveNeedsFirstSave(null)).toBe(false)
  })

  it('the switch renders disabled with the explaining tip, keeping its label and aria state', () => {
    const app = readFileSync(join(__dirname, '../src/renderer/App.tsx'), 'utf8')
    const toggle = app.slice(app.indexOf('<label\n            className={`autosave-toggle'))
    const block = toggle.slice(0, toggle.indexOf('</label>'))
    expect(block).toContain("autoSaveBlocked ? ' disabled' : ''")
    expect(block).toContain("t(autoSaveBlocked ? 'appAutoSaveNeedsSaveTip' : 'appAutoSaveTip')")
    expect(block).toContain('aria-disabled={autoSaveBlocked || undefined}')
    expect(block).toContain('disabled={autoSaveBlocked}')
    expect(block).toContain("t('appAutoSave')")
  })

  it('has en and vi copy', () => {
    expect(en.appAutoSaveNeedsSaveTip).toBe('Save the document first to turn on AutoSave')
    expect(viStrings.appAutoSaveNeedsSaveTip).toBe('Hãy lưu tài liệu trước để bật Tự động lưu')
  })
})

describe('the common save boundary refuses an auto save of a converted copy (F1)', () => {
  // the section-break insertion effect calls save(false, true) outside the AutoSave timer
  function contextFor(doc: Doc) {
    const touched = { editor: false }
    const ctx = {
      doc,
      get editor() {
        touched.editor = true
        return undefined
      },
    } as unknown as Parameters<typeof save>[0]
    return { ctx, touched }
  }
  const convertedWithPath = {
    filePath: '/tmp/uniwork-legacy/Memo.docx',
    suggestSaveAs: '/home/me/Memo.docx',
  } as unknown as Doc

  it('refuses an auto save whatever triggered it and never starts a write pass', async () => {
    const { ctx, touched } = contextFor(convertedWithPath)
    await expect(save(ctx, false, true)).resolves.toBe(false)
    expect(touched.editor).toBe(false)
  })

  it('lets the shell in-place flush and an explicit Save through', async () => {
    const inPlace = contextFor(convertedWithPath)
    await save(inPlace.ctx, false, false, undefined, undefined, true)
    expect(inPlace.touched.editor).toBe(true)
    const explicit = contextFor(convertedWithPath)
    await save(explicit.ctx, false, false)
    expect(explicit.touched.editor).toBe(true)
  })

  it('keeps the section-save behaviour of a normal document', async () => {
    const { ctx, touched } = contextFor({ filePath: '/home/me/Memo.docx' } as unknown as Doc)
    await save(ctx, false, true)
    expect(touched.editor).toBe(true)
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
