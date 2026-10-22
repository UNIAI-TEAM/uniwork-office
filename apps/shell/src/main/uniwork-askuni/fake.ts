import type {
  AskUniCitation,
  AskUniContext,
  AskUniRequest,
  AskUniResult,
} from '../../shared/askuni-api'
import type { AskUniClient } from './client'

/**
 * Test/dev only: canned Ask UNI answers for the Home renderer and the visual
 * stage, with no server and no account. Switched on by UNIWORK_ASKUNI_FAKE=1
 * and never in a packaged build; the question prefix picks the answer
 * (`docs:`, `none:`, `quota:`, `rate:`, `forbidden:`, `offline:`, `disabled:`,
 * anything else = a plain answer).
 */

export const ASKUNI_FAKE_ENV = 'UNIWORK_ASKUNI_FAKE'

export function askUniFakeEnabled(env: NodeJS.ProcessEnv, packaged: boolean): boolean {
  return !packaged && env[ASKUNI_FAKE_ENV] === '1'
}

/** the canned sources (shared with the streaming fake) */
export const FAKE_CITATIONS: AskUniCitation[] = [
  {
    sourceId: 'S1',
    kind: 'document',
    title: 'Q4 budget plan',
    quote: 'Marketing spend is capped at 120M for the quarter.',
    href: '/acme/team/documents/fakedoc0000000000000001',
  },
  {
    sourceId: 'S2',
    kind: 'document',
    title: 'Hiring roadmap',
    quote: 'Two backend roles open in November.',
    href: '/acme/team/documents/fakedoc0000000000000002',
  },
  {
    sourceId: 'S3',
    kind: 'document',
    title: 'Vendor contract renewal',
    quote: 'The renewal date is the 15th of December.',
    href: '/acme/team/documents/fakedoc0000000000000003',
  },
  {
    sourceId: 'S4',
    kind: 'task',
    title: 'Send the budget to finance',
    quote: 'Due 2026-10-30.',
    href: '/acme/team/tasks/faketask0000000000000001',
  },
]

const FAKE_WORKSPACE = { id: 'ws_fake', name: 'Fake workspace' }

export interface FakeAskUni {
  client: AskUniClient
  context(): Promise<AskUniContext>
}

export function createFakeAskUni(options: { delayMs?: number } = {}): FakeAskUni {
  const delayMs = options.delayMs ?? 600
  let counter = 0
  const pause = (): Promise<void> =>
    delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve()

  const answer = (
    req: AskUniRequest,
    content: string,
    citations: AskUniCitation[],
  ): AskUniResult => {
    counter += 1
    return {
      ok: true,
      conversationId: req.conversationId ?? 'fakeconv0000000000000001',
      message: { id: `fakemsg${String(counter).padStart(12, '0')}`, content, citations },
    }
  }

  return {
    client: {
      async ask(req) {
        await pause()
        const q = req.question.trim().toLowerCase()
        if (q.startsWith('docs:')) {
          return answer(
            req,
            'The budget is capped at 120M [S1], two backend roles open in November [S2], the vendor renews on 15 December [S3] and the budget goes to finance by 30 October [S4].',
            FAKE_CITATIONS,
          )
        }
        if (q.startsWith('none:')) {
          const result = answer(req, '', [])
          return result.ok
            ? { ...result, message: { ...result.message, notice: 'no_sources' } }
            : result
        }
        if (q.startsWith('quota:')) return { ok: false, code: 'quota' }
        if (q.startsWith('rate:')) return { ok: false, code: 'rate_limited', retryAfterSec: 30 }
        if (q.startsWith('forbidden:')) return { ok: false, code: 'forbidden' }
        if (q.startsWith('offline:')) return { ok: false, code: 'offline' }
        if (q.startsWith('disabled:')) return { ok: false, code: 'disabled' }
        return answer(req, 'This is a canned Ask UNI answer with no sources.', [])
      },
    },
    async context() {
      return { workspaces: [FAKE_WORKSPACE], currentWorkspaceId: FAKE_WORKSPACE.id, signedIn: true }
    },
  }
}
