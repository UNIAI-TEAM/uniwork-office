import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { workbenchStrings } from '../src/renderer/src/i18n/strings-workbench'

/** Workbench chrome reads its copy from the i18n shard (spec 6.8), not from label(vi, en). */
const FILES = [
  'PracticeHome.tsx',
  'WorkbenchTabs.tsx',
  'SkillDomainTabs.tsx',
  'WorkbenchModulePanes.tsx',
]

describe('Workbench copy lives in the i18n shard', () => {
  it.each(FILES)('%s has no label(vi, en) helper left', (file) => {
    const source = readFileSync(join(__dirname, '../src/renderer/src', file), 'utf8')
    expect(source).not.toMatch(/\blabel\(/)
    expect(source).not.toMatch(/const label = /)
  })

  it('keeps the copy in formal Vietnamese and in English', () => {
    expect(workbenchStrings.vi.wbCommonUnpin).toBe('Bỏ ghim')
    expect(workbenchStrings.en.wbCommonUnpin).toBe('Unpin tab')
    expect(workbenchStrings.vi.wbKnDeletePackConfirm).toContain('{title}')
    expect(workbenchStrings.zh.wbFormsDraft).toBe('起草')
  })
})
