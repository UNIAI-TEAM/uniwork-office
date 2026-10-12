// G6-12 (UNI-1366): html ask_clarification writes nothing, so every result it
// returns must declare mutated: false (the tool table column reads `no`).
import { describe, expect, it } from 'vitest'
import { createHtmlSkillCore, type HtmlDocAccess } from '../src/renderer/ai/tools'
import { buildParseMap } from '../src/renderer/document/parse-map'

function access(over: Partial<HtmlDocAccess> = {}): HtmlDocAccess {
  const text = ''
  const map = buildParseMap(text, 1)
  return {
    getText: () => text,
    getVersion: () => 1,
    getMap: () => map,
    getLastManualVersion: () => 0,
    getFilePath: () => '/tmp/page.html',
    getSelectedSid: () => null,
    applyOps: () => ({ ok: true, ranges: [] }),
    replaceAll: () => {},
    ...over,
  }
}

const ask = (questions: unknown) => ({
  id: 'c1',
  name: 'ask_clarification',
  input: { questions },
})
const QUESTIONS = [{ id: 'aud', label: 'Audience?', options: ['board', 'team'] }]

describe('html ask_clarification declares mutated: false', () => {
  it('on a user answer', async () => {
    const core = createHtmlSkillCore(
      access({ askClarification: async () => ({ answers: 'a: b' }) }),
    )
    const r = await core.executeTool(ask(QUESTIONS))
    expect(r.isError).toBeFalsy()
    expect(r.mutated).toBe(false)
  })

  it('on a skip', async () => {
    const core = createHtmlSkillCore(
      access({ askClarification: async () => ({ answers: '', cancelled: true }) }),
    )
    const r = await core.executeTool(ask(QUESTIONS))
    expect(r.output).toMatch(/skipped/)
    expect(r.mutated).toBe(false)
  })

  it('when the card is unavailable or the questions are empty', async () => {
    const none = await createHtmlSkillCore(access()).executeTool(ask(QUESTIONS))
    expect(none.isError).toBe(true)
    expect(none.mutated).toBe(false)
    const empty = await createHtmlSkillCore(
      access({ askClarification: async () => ({ answers: '' }) }),
    ).executeTool(ask([]))
    expect(empty.isError).toBe(true)
    expect(empty.mutated).toBe(false)
  })
})
