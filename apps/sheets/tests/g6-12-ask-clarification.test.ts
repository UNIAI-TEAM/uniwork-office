// §9 #25 / C-ASK: sheets gets html's ask_clarification so the model can
// confirm what a column means or where results go before it calculates or
// writes (spec §6.5 X/Y/Z example). Same input schema and result text as
// html; the card blocks the run until the user answers or skips.
import { describe, expect, it, vi } from 'vitest'

import { AGENT_TOOLS as HTML_TOOLS } from '../../html/src/renderer/ai/tools'
import { WORKBOOK_TOOLS, executeWorkbookTool, type SheetsSkillDeps } from '../src/renderer/ai/tools'
import { VIEW_ONLY_TOOLS } from '../src/renderer/ai/view-only-skill'
import { zh } from '../src/renderer/i18n/ai/zh'
import { en } from '../src/renderer/i18n/ai/en'
import { vi as viShard } from '../src/renderer/i18n/ai/vi'

const tool = (list: readonly { name: string }[], name: string) =>
  list.find((entry) => entry.name === name) as
    { name: string; description: string; inputSchema: unknown } | undefined

const question = {
  id: 'z',
  label: 'What does column Z hold?',
  options: ['Net revenue', 'Gross revenue', 'Tax'],
}

function deps(askClarification?: SheetsSkillDeps['askClarification']): SheetsSkillDeps {
  return { askClarification } as unknown as SheetsSkillDeps
}

const ask = (d: SheetsSkillDeps, input: Record<string, unknown>) =>
  Promise.resolve(executeWorkbookTool({ id: 'q1', name: 'ask_clarification', input }, d))

describe('g6-12 sheets ask_clarification', () => {
  it('is offered with the html input schema, byte for byte', () => {
    const sheets = tool(WORKBOOK_TOOLS, 'ask_clarification')
    const html = tool(HTML_TOOLS, 'ask_clarification')
    expect(sheets).toBeDefined()
    expect(JSON.stringify(sheets!.inputSchema)).toBe(JSON.stringify(html!.inputSchema))
  })

  it('describes confirming column meaning / target range before calculating or writing', () => {
    const description = tool(WORKBOOK_TOOLS, 'ask_clarification')!.description
    expect(description).toMatch(/column/i)
    expect(description).toMatch(/range/i)
    expect(description).toMatch(/before/i)
  })

  it('stays available on a view-only workbook (it changes nothing)', () => {
    expect(VIEW_ONLY_TOOLS.has('ask_clarification')).toBe(true)
  })

  it('waits for the answers and returns them in the html result format', async () => {
    const askClarification = vi.fn(async () => ({
      answers: 'What does column Z hold?: Net revenue',
    }))
    const result = await ask(deps(askClarification), { questions: [question] })
    expect(askClarification).toHaveBeenCalledWith([
      { ...question, description: undefined, multi: false },
    ])
    expect(result.isError).toBeUndefined()
    expect(result.mutated).toBe(false)
    expect(result.output.startsWith('User answers:\nWhat does column Z hold?: Net revenue\n')).toBe(
      true,
    )
    expect(result.summary).toBe(zh.aiToolClarify)
  })

  it('returns the skipped result when the user skips, stops or starts a new chat', async () => {
    const result = await ask(
      deps(async () => ({ answers: '', cancelled: true })),
      { questions: [question] },
    )
    expect(result.isError).toBeUndefined()
    expect(result.mutated).toBe(false)
    expect(result.output).toMatch(/^The user skipped the questionnaire\./)
    expect(result.summary).toBe(zh.aiToolClarifySkipped)
  })

  it('refuses empty questions and keeps at most 4 questions / 5 options', async () => {
    const askClarification = vi.fn(async () => ({ answers: 'x' }))
    const empty = await ask(deps(askClarification), {
      questions: [{ id: 'a', label: '', options: [] }],
    })
    expect(empty.isError).toBe(true)
    expect(askClarification).not.toHaveBeenCalled()

    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `q${i}`,
      label: `Question ${i}`,
      options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    }))
    await ask(deps(askClarification), { questions: many })
    const asked = askClarification.mock.calls[0]![0] as unknown as { options: string[] }[]
    expect(asked).toHaveLength(4)
    expect(asked.every((q) => q.options.length === 5)).toBe(true)
  })

  it('fails typed where no card can be shown', async () => {
    const result = await ask(deps(undefined), { questions: [question] })
    expect(result.isError).toBe(true)
  })

  it('has its card strings in the zh key set and the en/vi shards', () => {
    for (const key of [
      'aiClarifyTitle',
      'aiClarifySubmit',
      'aiClarifySkip',
      'aiToolClarify',
      'aiToolClarifySkipped',
    ] as const) {
      expect((zh as Record<string, string>)[key]).toBeTruthy()
      expect((en as Record<string, string>)[key]).toBeTruthy()
      expect((viShard as Record<string, string>)[key]).toBeTruthy()
    }
  })
})
