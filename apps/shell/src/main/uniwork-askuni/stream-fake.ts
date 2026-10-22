import type { AskUniCitation, AskUniMessage, AskUniStreamRequest } from '../../shared/askuni-api'
import type { FakeAskUniStore } from './rest-fake'
import { FAKE_CITATIONS } from './fake'
import type { AskUniStreamClient, AskUniStreamPayload, AskUniStreamTerminal } from './stream-client'

/**
 * Test/dev only: a streamed Ask UNI answer for the renderer and the visual
 * stage, with no server and no account (UNIWORK_ASKUNI_FAKE=1, never in a
 * packaged build - the same gate as the P1 fake). The script is run, two
 * steps, word deltas every `delayMs`, citations, done. The question prefix
 * picks the case: the P1 ones (`docs:`, `none:`, `quota:`, `rate:`,
 * `forbidden:`, `offline:`, `disabled:`) plus `slow:` (a long answer to
 * Stop), `drop:` (ends without done) and `err:` (an error mid-stream). With a
 * `store`, each finished answer is kept in the REST fake's history.
 */

/** UNIWORK_ASKUNI_FAKE_STREAM=0 shows the P1 pane under the fake */
export const ASKUNI_FAKE_STREAM_ENV = 'UNIWORK_ASKUNI_FAKE_STREAM'

export function askUniFakeStreamFlag(env: NodeJS.ProcessEnv): boolean {
  return env[ASKUNI_FAKE_STREAM_ENV] !== '0'
}

const DOCS_ANSWER =
  'The budget is capped at 120M [S1], two backend roles open in November [S2], the vendor renews on 15 December [S3] and the budget goes to finance by 30 October [S4].'
const PLAIN_ANSWER = 'This is a canned Ask UNI answer with no sources.'
const SLOW_ANSWER = Array.from(
  { length: 40 },
  (_, i) => `Point ${i + 1} of a long answer that keeps streaming so Stop can be tried.`,
).join(' ')

const CANCELLED: AskUniStreamTerminal = { type: 'error', code: 'cancelled' }

export function createFakeAskUniStream(
  options: { delayMs?: number; store?: FakeAskUniStore } = {},
): AskUniStreamClient {
  const store = options.store
  const delayMs = options.delayMs ?? 80
  let counter = 0

  /** waits one tick of the script; false once the request was aborted */
  const pause = (signal: AbortSignal): Promise<boolean> =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve(false)
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve(!signal.aborted)
      }, delayMs)
      const onAbort = () => {
        clearTimeout(timer)
        resolve(false)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })

  return {
    async stream(req: AskUniStreamRequest, { signal, onEvent }) {
      const q = req.question.trim().toLowerCase()
      if (!(await pause(signal))) return CANCELLED
      if (q.startsWith('quota:')) return { type: 'error', code: 'quota' }
      if (q.startsWith('rate:'))
        return { type: 'error', code: 'rate_limited', retryAfterSeconds: 30 }
      if (q.startsWith('forbidden:')) return { type: 'error', code: 'forbidden' }
      if (q.startsWith('offline:')) return { type: 'error', code: 'offline' }
      if (q.startsWith('disabled:')) return { type: 'error', code: 'disabled' }

      counter += 1
      const conversationId = store
        ? store.conversationFor(req)
        : (req.conversationId ?? 'fakeconv0000000000000001')
      /** a finished answer goes to the REST fake's history (rest-fake.ts) */
      const done = (msg: AskUniMessage): AskUniStreamTerminal => {
        store?.record(req, conversationId, msg)
        return { type: 'done', message: msg }
      }
      const emit = async (ev: AskUniStreamPayload): Promise<boolean> => {
        if (signal.aborted) return false
        onEvent(ev)
        return pause(signal)
      }
      const docs = q.startsWith('docs:')
      const none = q.startsWith('none:')
      const answer = docs ? DOCS_ANSWER : q.startsWith('slow:') ? SLOW_ANSWER : PLAIN_ANSWER
      const citations: AskUniCitation[] = docs ? FAKE_CITATIONS : []

      const script: AskUniStreamPayload[] = [
        { type: 'run', runId: `fakerun${String(counter).padStart(12, '0')}`, conversationId },
        {
          type: 'step',
          round: 1,
          phase: 'tool',
          tool: 'search_documents',
          counts: { document: 3 },
        },
        { type: 'step', round: 2, phase: 'tool', tool: 'search_tasks', counts: { task: 1 } },
      ]
      for (const ev of script) if (!(await emit(ev))) return CANCELLED
      if (none) {
        return done(message(counter, '', [], 'no_sources'))
      }
      // word by word, the spaces kept, so the deltas join to the stored content
      const words = answer.match(/\S+\s*/g) ?? []
      let streamed = ''
      for (const [i, word] of words.entries()) {
        if (!(await emit({ type: 'delta', text: word }))) return CANCELLED
        streamed += word
        if (i === 4 && q.startsWith('drop:')) return { type: 'error', code: 'stream_ended' }
        if (i === 4 && q.startsWith('err:')) return { type: 'error', code: 'provider_error' }
      }
      if (citations.length && !(await emit({ type: 'citations', citations }))) return CANCELLED
      return done(message(counter, streamed, citations))
    },
  }
}

function message(
  n: number,
  content: string,
  citations: AskUniCitation[],
  notice?: 'no_sources',
): Extract<AskUniStreamTerminal, { type: 'done' }>['message'] {
  return {
    id: `fakemsg${String(n).padStart(12, '0')}`,
    role: 'assistant',
    content,
    citations,
    ...(notice ? { notice } : {}),
    createdAt: new Date().toISOString(),
  }
}
