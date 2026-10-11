import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeSkills, type AgentSkill } from '@genoffice/agent-core'
import { describe, expect, it, vi } from 'vitest'

import { createFilesSkill } from '../src/renderer/ai/files-skill'
import { createSearchSkill } from '../src/renderer/ai/search-skill'
import {
  VIEW_ONLY_TOOLS,
  isUniworkViewOnly,
  restrictToReading,
} from '../src/renderer/ai/view-only-skill'
import { createWorkbookSkill } from '../src/renderer/ai/workbook-skill'
import { strings } from '../src/renderer/i18n/strings'
import type { SheetsSkillDeps } from '../src/renderer/ai/tools'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

function fakeDeps(proposeOperations = vi.fn()): SheetsSkillDeps {
  return {
    getActiveSheetInfo: () => ({
      mode: 'demo',
      sheetId: 'sheet-1',
      sheetName: 'Sheet1',
      revision: 0,
      knownAddresses: ['A1'],
      sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
      selection: 'A1',
    }),
    readCells: () => ({}),
    readFormats: () => ({}),
    readSheetFeatures: () => '',
    findCells: () => ({ matches: [], truncated: false, incompleteSheets: [] }),
    selectRange: () => ({ ok: true, sheetName: 'Sheet1' }),
    tracePrecedents: () => ({ refs: [] }),
    traceDependents: () => ({ dependents: [], truncated: false, incompleteSheets: [] }),
    proposeOperations,
  } as unknown as SheetsSkillDeps
}

function composed(viewOnly: { current: boolean }, propose = vi.fn()): AgentSkill {
  return composeSkills(
    'sheets+files',
    '',
    [createWorkbookSkill(fakeDeps(propose)), createFilesSkill(() => []), createSearchSkill()].map(
      (skill) => restrictToReading(skill, () => viewOnly.current),
    ),
  )
}

describe('isUniworkViewOnly', () => {
  it('is true only for a bound, read-only workbook', () => {
    expect(isUniworkViewOnly({ uniworkBound: true, readOnly: true })).toBe(true)
    expect(isUniworkViewOnly({ uniworkBound: true, readOnly: false })).toBe(false)
    expect(isUniworkViewOnly({ readOnly: true })).toBe(false)
    expect(isUniworkViewOnly(null)).toBe(false)
  })
})

describe('view-only workbook: the AI can read but not edit', () => {
  it('offers only reading tools and notes the workbook is view-only', () => {
    const viewOnly = { current: true }
    const skill = composed(viewOnly)
    const names = skill.tools.map((tool) => tool.name)
    expect(names).toContain('get_workbook_context')
    expect(names).toContain('read_range')
    expect(names).not.toContain('propose_operations')
    expect(names).not.toContain('create_document')
    expect(names.every((name) => VIEW_ONLY_TOOLS.has(name))).toBe(true)
    expect(skill.systemPrompt).toContain('view-only')
  })

  it('refuses an edit tool the model calls anyway and never reaches the workbook', async () => {
    const propose = vi.fn()
    const skill = composed({ current: true }, propose)
    const result = await skill.executeTool({
      id: 'c1',
      name: 'propose_operations',
      input: { operations: [], summary: 'x' },
    })
    expect(result.isError).toBe(true)
    expect(propose).not.toHaveBeenCalled()
    const wrapped = restrictToReading(createWorkbookSkill(fakeDeps(propose)), () => true)
    const direct = await wrapped.executeTool({ id: 'c2', name: 'propose_operations', input: {} })
    expect(direct.isError).toBe(true)
    expect(direct.output).toContain('view-only')
    expect(propose).not.toHaveBeenCalled()
  })

  it('keeps the full tool set for an editable (or unbound) workbook', () => {
    const viewOnly = { current: false }
    const skill = composed(viewOnly)
    expect(skill.tools.map((tool) => tool.name)).toContain('propose_operations')
    expect(skill.systemPrompt).not.toContain('view-only')
    viewOnly.current = true
    expect(skill.tools.map((tool) => tool.name)).not.toContain('propose_operations')
  })

  it('has a reason in en and vi that every locale carries', () => {
    const dicts = strings as unknown as Record<string, Record<string, string>>
    expect(dicts.en!.aiViewOnlyNotice).toMatch(/view-only/i)
    expect(dicts.vi!.aiViewOnlyNotice).toContain('chỉ xem')
    for (const [lang, dict] of Object.entries(dicts)) {
      expect(dict.aiViewOnlyNotice, lang).toBeTruthy()
    }
  })
})

describe('view-only wiring', () => {
  const appSrc = read('src/renderer/App.tsx')
  const shellSrc = read('src/renderer/ExcelShell.tsx')
  const panelSrc = read('src/renderer/ai/AiChatPanel.tsx')

  it('restricts every skill of the loop and refuses auto-applied plans', () => {
    expect(appSrc).toContain('restrictToReading(skill, () => aiViewOnlyRef.current)')
    expect(appSrc).toMatch(/if \(aiViewOnlyRef\.current\) return \{ ok: false/)
    expect(appSrc).toContain('aiViewOnly={aiViewOnly}')
  })

  it('disables the editing ribbon AI action and shows the composer notice', () => {
    expect(shellSrc).toMatch(/aiViewOnly \?[\s\S]*?disabled[\s\S]*?t\('aiViewOnlyNotice'\)/)
    expect(shellSrc).toContain('viewOnly={aiViewOnly}')
    expect(panelSrc).toMatch(/viewOnly && \(\s*<div className="ai-view-only-notice"/)
  })
})

describe('AutoSave toggle of a UniWork workbook', () => {
  const shellSrc = read('src/renderer/ExcelShell.tsx')
  const appSrc = read('src/renderer/App.tsx')

  it('is not rendered when the workbook is bound or view-only', () => {
    expect(shellSrc).toContain("cap('autoSave') && !autoSaveHidden && (")
    expect(appSrc).toContain('autoSaveHidden={autoSaveLocked}')
    expect(appSrc).toContain('const autoSaveLocked = uniworkAutoSaveLocked(workbookFile)')
  })

  it('never ticks the autosave timer for a locked workbook', () => {
    expect(appSrc).toContain('const autoSaveOn = autoSave && !autoSaveLocked')
  })
})
