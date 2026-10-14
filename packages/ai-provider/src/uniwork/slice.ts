/**
 * What one UniWork AI request carries out of the loop's history (design §3.4):
 * the server keeps the conversation, so a request is only the new question
 * or the tool results of the calls the server just issued. Never the system
 * prompt, an assistant turn, an older message or a compaction summary.
 */
import type { AgentMessage } from '@genoffice/agent-core'
import { UniworkError } from './errors'

/** the façade's cap on a question, in runes (Unicode code points): openai_facade.go UniworkQuestionMaxRunes */
export const UNIWORK_QUESTION_MAX_RUNES = 8000

/** model-facing marker after a clipped editor context (wire text, never shown in the panel) */
export const UNIWORK_CONTEXT_CLIPPED_MARKER =
  '\n\n[The editor context was clipped here to fit the request size limit.]'

// the façade decodes `content` as a string: image parts are never sent
export type UniworkWireMessage =
  { role: 'user'; content: string } | { role: 'tool'; tool_call_id: string; content: string }

export interface UniworkTurnSlice {
  /** question: a user message (opens a run, or continues one right after tool results); tool-result: needs the run id */
  kind: 'question' | 'tool-result'
  messages: UniworkWireMessage[]
  /** a question right after tool results (the loop's own follow-up inside the run) */
  continuesRun: boolean
  /** the question had images; they were left out (the façade takes text only) */
  imagesDropped?: boolean
  /** the editor context was clipped to fit the question cap */
  contextClipped?: boolean
}

function runeCount(text: string): number {
  let n = 0
  for (const _ of text) n++
  return n
}

/** the first `max` runes of `text`, never splitting a surrogate pair */
function clipRunes(text: string, max: number): string {
  if (max <= 0) return ''
  let n = 0
  let end = 0
  for (const ch of text) {
    if (n === max) break
    n++
    end += ch.length
  }
  return text.slice(0, end)
}

/**
 * The question text within the façade's cap. The user's instruction is kept
 * whole; the editor context after it is clipped with a marker. A message with
 * no separate instruction is all the user's own words and is never clipped.
 * Throws `question_too_long` when the user's words alone are over the cap.
 */
function capQuestion(message: Extract<AgentMessage, { role: 'user' }>): {
  text: string
  clipped: boolean
} {
  const text = message.text
  if (runeCount(text) <= UNIWORK_QUESTION_MAX_RUNES) return { text, clipped: false }
  const instruction = message.instruction
  if (instruction === undefined || !text.startsWith(instruction)) {
    throw new UniworkError('question_too_long')
  }
  const own = runeCount(instruction)
  if (own > UNIWORK_QUESTION_MAX_RUNES) throw new UniworkError('question_too_long')
  const budget = UNIWORK_QUESTION_MAX_RUNES - own - runeCount(UNIWORK_CONTEXT_CLIPPED_MARKER)
  // no room left for any context: the instruction alone goes out
  if (budget <= 0) return { text: instruction, clipped: true }
  const context = clipRunes(text.slice(instruction.length), budget)
  return { text: `${instruction}${context}${UNIWORK_CONTEXT_CLIPPED_MARKER}`, clipped: true }
}

export function sliceUniworkTurn(history: AgentMessage[]): UniworkTurnSlice {
  const last = history.at(-1)
  if (!last || last.role === 'assistant') {
    throw new Error('UniWork AI turn: the history must end with a question or tool results')
  }
  if (last.role === 'user') {
    const { text, clipped } = capQuestion(last)
    return {
      kind: 'question',
      messages: [{ role: 'user', content: text }],
      continuesRun: history.at(-2)?.role === 'tool',
      ...(last.images?.length ? { imagesDropped: true } : {}),
      ...(clipped ? { contextClipped: true } : {}),
    }
  }
  // every tool message after the last assistant turn answers that turn's calls
  const results: UniworkWireMessage[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!
    if (m.role !== 'tool') break
    const round = m.results.map((r) => ({
      role: 'tool' as const,
      tool_call_id: r.id,
      // the same failure marking as the BYOK openai-compatible path
      content: r.isError ? `Error: ${r.output}` : r.output,
    }))
    results.unshift(...round)
  }
  return { kind: 'tool-result', messages: results, continuesRun: true }
}
