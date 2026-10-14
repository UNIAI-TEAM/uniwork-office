/**
 * What one UniWork AI request carries out of the loop's history (design §3.4):
 * the server keeps the conversation, so a request is only the new question
 * or the tool results of the calls the server just issued. Never the system
 * prompt, an assistant turn, an older message or a compaction summary.
 */
import type { AgentMessage } from '@genoffice/agent-core'

export type UniworkWireMessage =
  | { role: 'user'; content: string | Array<Record<string, unknown>> }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface UniworkTurnSlice {
  /** question: a user message (opens a run, or continues one right after tool results); tool-result: needs the run id */
  kind: 'question' | 'tool-result'
  messages: UniworkWireMessage[]
  /** a question right after tool results (the loop's own follow-up inside the run) */
  continuesRun: boolean
}

export function sliceUniworkTurn(history: AgentMessage[]): UniworkTurnSlice {
  const last = history.at(-1)
  if (!last || last.role === 'assistant') {
    throw new Error('UniWork AI turn: the history must end with a question or tool results')
  }
  if (last.role === 'user') {
    const content = last.images?.length
      ? [
          ...(last.text ? [{ type: 'text', text: last.text }] : []),
          ...last.images.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:${img.mime};base64,${img.base64}` },
          })),
        ]
      : last.text
    return {
      kind: 'question',
      messages: [{ role: 'user', content }],
      continuesRun: history.at(-2)?.role === 'tool',
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
