import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OPEN_DIALOG_EXTENSIONS,
  OPEN_DIALOG_UNSUPPORTED_EXTENSIONS,
  openLocalHint,
} from '../src/shared/open-extensions'

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

describe('the Home "Open local file" hint', () => {
  it('names the legacy binaries it deliberately leaves out', () => {
    expect(OPEN_DIALOG_UNSUPPORTED_EXTENSIONS).toEqual(['doc', 'ppt'])
    for (const ext of OPEN_DIALOG_UNSUPPORTED_EXTENSIONS) {
      expect(OPEN_DIALOG_EXTENSIONS).toContain(ext)
    }
  })

  it('is the dialog list in the same order, minus the unsupported ones', () => {
    expect(openLocalHint()).toBe(
      '.docx / .xlsx / .xlsm / .xls / .csv / .tsv / .pptx / .pdf / .md / .markdown / .txt / .json / .html / .htm',
    )
    const shown = openLocalHint()
      .split(' / ')
      .map((e) => e.slice(1))
    expect(shown).toEqual(
      OPEN_DIALOG_EXTENSIONS.filter((e) => !OPEN_DIALOG_UNSUPPORTED_EXTENSIONS.includes(e)),
    )
    expect(shown).not.toContain('doc')
    expect(shown).not.toContain('ppt')
  })

  it('Home reads the shared list instead of a hand-typed copy', () => {
    const home = readFileSync(join(__dirname, '../src/renderer/src/Home.tsx'), 'utf8')
    expect(home).toMatch(/openLocalHint\(\)/)
    expect(home).not.toMatch(/'\.docx \/ \.xlsx/)
  })
})

/**
 * FD-14 regression guard: only the Open pickers narrow to UniWork Office
 * formats. The My AI chat attachment input stays unrestricted, because images
 * are intended attachments there.
 */
describe('the My AI chat attachment input', () => {
  const src = readFileSync(join(__dirname, '../src/renderer/src/NewChatPane.tsx'), 'utf8')
  const input = src.match(/<input\s[^>]*?ref=\{fileInputRef\}[\s\S]*?onChange/)?.[0] ?? ''

  it('is a multi-file input', () => {
    expect(input).toMatch(/type="file"/)
    expect(input).toMatch(/\bmultiple\b/)
  })

  it('has no accept list, so images (and everything else) can still be attached', () => {
    expect(input).not.toMatch(/\baccept=/)
  })
})
