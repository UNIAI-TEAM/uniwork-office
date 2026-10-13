// §9 #17 / C-BOUND: create_document writes a new file outside the open
// workbook, so a UniWork-bound workbook never offers it (tool + prompt bullet
// hidden) and a stray call is refused. Local workbooks keep it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetForTest } from '../src/renderer/capabilities'
import { executeWorkbookTool, type SheetsSkillDeps } from '../src/renderer/ai/tools'
import { createWorkbookSkill } from '../src/renderer/ai/workbook-skill'

const g = globalThis as { window?: unknown }
const hadWindow = 'window' in g
const previousWindow = g.window

beforeEach(() => {
  // desktop: no capabilities object, every entry on
  g.window = { desktopApi: {} }
  resetForTest()
})

afterEach(() => {
  if (hadWindow) g.window = previousWindow
  else delete g.window
  resetForTest()
})

const names = (skill: { tools: readonly { name: string }[] }) => skill.tools.map((t) => t.name)

function deps(bound: { value: boolean }) {
  const createDocument = vi.fn<NonNullable<SheetsSkillDeps['createDocument']>>(async () => ({
    ok: true,
    name: 'Sheet1.xlsx',
    path: '/tmp/Sheet1.xlsx',
    sheetName: 'Sheet1',
  }))
  const value = {
    getActiveSheetInfo: () => ({
      mode: 'demo',
      sheetId: 'sheet-1',
      sheetName: 'Sheet1',
      revision: 0,
      knownAddresses: [],
      sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    }),
    createDocument,
    isUniworkBound: () => bound.value,
  } as unknown as SheetsSkillDeps
  return { value, createDocument }
}

describe('g6-12 create_document for a UniWork-bound workbook', () => {
  it('hides the tool and its prompt bullet while bound, live', () => {
    const bound = { value: true }
    const skill = createWorkbookSkill(deps(bound).value)
    expect(names(skill)).not.toContain('create_document')
    expect(names(skill)).toContain('propose_operations')
    expect(skill.systemPrompt).not.toContain('tool create_document')
    // the getters re-read the bound state before every request
    bound.value = false
    expect(names(skill)).toContain('create_document')
    expect(skill.systemPrompt).toContain('tool create_document')
  })

  it('refuses a stray call while bound without writing anything', async () => {
    const { value, createDocument } = deps({ value: true })
    const result = await executeWorkbookTool(
      { id: 'c1', name: 'create_document', input: { type: 'xlsx' } },
      value,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toMatch(/UniWork/)
    expect(createDocument).not.toHaveBeenCalled()
  })

  it('keeps create_document for a local workbook', async () => {
    const { value, createDocument } = deps({ value: false })
    expect(names(createWorkbookSkill(value))).toContain('create_document')
    const result = await executeWorkbookTool(
      { id: 'c1', name: 'create_document', input: { type: 'xlsx' } },
      value,
    )
    expect(result.isError).toBeUndefined()
    expect(createDocument).toHaveBeenCalledTimes(1)
  })
})
