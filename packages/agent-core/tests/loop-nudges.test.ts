// Every user message the loop pushes itself is one of LOOP_NUDGE_TEXTS, so a host that follows the
// person's turns (the web `ai.start` handoff) never reads it as the person's own question.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as loop from '../src/loop'

const source = readFileSync(fileURLToPath(new URL('../src/loop.ts', import.meta.url)), 'utf8')
/** the text expression of every `history.push({ role: 'user', text: <expr> ... })` in loop.ts */
const pushed = [
  ...source.matchAll(/history\.push\(\{\s*role:\s*'user',\s*text:\s*([^,}]+?)\s*[,}]/g),
].map((m) => m[1]!)

describe('the loop pushes only its nudge texts as user messages', () => {
  it('every pushed text is a LOOP_NUDGE_TEXTS entry', () => {
    expect(pushed.length).toBeGreaterThan(0)
    for (const expr of pushed) {
      // a skill's verifyResponse result: a closed list, checked below
      if (expr === 'correction') continue
      expect(loop.LOOP_NUDGE_TEXTS).toContain((loop as Record<string, unknown>)[expr])
    }
  })

  it("the skills' corrections are in the list", () => {
    expect(loop.LOOP_NUDGE_TEXTS).toContain(loop.SELECTION_CLAIM_CORRECTION)
  })
})
