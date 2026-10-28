/**
 * A job the host hands to the AI panel (`ai.start`, UNI-2264), followed part by part.
 *
 * `start` keeps `{ handoffId, pendingHeader: true }` and sends the panel one preset (a listener
 * gets it at once; without one it waits for one `consumeAiPreset`). Every UniWork AI question that
 * runs it carries `X-UniWork-AI-Handoff: <id>` (its run_expired / 429 resends too, never a
 * tool-result request) until an answer to it comes back OK: the server expanded the job into that
 * question and says `X-UniWork-AI-Handoff-Remaining: <parts left after this one>`. A post with no
 * OK answer (offline, a 429 given up, a Stop, a restarted conversation) keeps the job pending, so
 * the panel's Retry or the re-sent question carries the header again.
 *
 * A part ends with the stream that leaves no tool call unanswered, not when the run tracker idles:
 * a tool step slower than the tracker's grace (a search, an image, a confirm card) idles the
 * tracker mid-part, and the tool results that follow resume the same part. At the idle after the
 * part's end, with no stream failed or stopped and at least one part left, a short continuation
 * preset goes out and its question carries the header again.
 *
 * A question the person asks themselves (any question that does not follow tool results and is not
 * the pending preset, on UniWork AI or another provider) drops the job: no continuation, no header,
 * no buffered preset. State lives in this frame page only; nothing is persisted.
 */
import type { AiStartPayload } from '../../../docs/protocol/types'
import type { AiRunTracker } from '../ai-run'

export const UNIWORK_HANDOFF_HEADER = 'X-UniWork-AI-Handoff'
export const UNIWORK_HANDOFF_REMAINING_HEADER = 'X-UniWork-AI-Handoff-Remaining'

/** what a panel runs: the desktop `AiPresetPayload` shape, always auto-run */
export interface AiPreset {
  text: string
  displayText: string
  autoRun: true
}

/** one stream of the panel's loop, as the handoff sees it */
export interface AiHandoffStream {
  /** the question's own words (the instruction, else the text); null = a tool-result stream */
  words: string | null
  /** the question follows tool results: the loop's own (the adapter's `continuesRun` rule) */
  afterTools: boolean
  /** a UniWork AI turn (only those carry the header) */
  uniwork: boolean
}

export interface AiHandoff {
  /** `ai.start` accepted: follow this job (replaces one already followed) */
  start(job: AiStartPayload): void
  /** the preset that arrived while no listener was there, once */
  consumePreset(): AiPreset | null
  /** presets as they arrive; returns the unsubscribe */
  onPreset(listener: (preset: AiPreset) => void): () => void
  /** a stream of the panel starts: the handoff id its requests carry, or null */
  stream(turn: AiHandoffStream): string | null
  /** a request that carried `id` was answered; `remaining` = its Remaining header */
  answered(id: string, ok: boolean, remaining: string | null): void
  /** a UniWork AI stream ended: failed or stopped, or with its tool calls unanswered */
  ended(outcome: { failed: boolean; openToolCalls: boolean }): void
}

interface Job {
  id: string
  /** the preset text its question must contain (normalized) */
  expect: string
  /** no OK answer to the header yet: the next matching question carries it */
  pendingHeader: boolean
}

/** the part in progress: from the question that carried the header to its idle */
interface Part {
  failed: boolean
  openToolCalls: boolean
  remaining: number
}

/** CRLF -> LF, whitespace runs -> one space, NFC: a composer may rewrite either */
function normalized(text: string): string {
  return text.replace(/\r\n?/g, '\n').normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function createAiHandoff(deps: {
  /** the frame's run tracker: the continuation goes out at its idle (absent = no continuation) */
  aiRun?: Pick<AiRunTracker, 'onChange'>
  /** the continuation text in the viewer's language */
  continueText(): string
}): AiHandoff {
  let job: Job | null = null
  let part: Part | null = null
  let buffered: AiPreset | null = null
  const listeners = new Set<(preset: AiPreset) => void>()

  function drop(): void {
    job = null
    part = null
    // a stale preset must not auto-run later without its header
    buffered = null
  }

  function send(text: string, displayText = text): void {
    const preset: AiPreset = { text, displayText, autoRun: true }
    if (listeners.size === 0) {
      buffered = preset
      return
    }
    buffered = null
    for (const listener of [...listeners]) {
      try {
        listener(preset)
      } catch (err) {
        console.error('[web-ai] onAiPreset listener threw', err)
      }
    }
  }

  deps.aiRun?.onChange((running) => {
    const followed = job
    const p = part
    if (running || !followed || !p) return
    // the header was never answered: the job stays pending for the next matching question
    if (followed.pendingHeader) {
      part = null
      return
    }
    // a tool step outlasted the grace: its results resume this part in the next run
    if (p.openToolCalls) return
    if (p.failed || p.remaining < 1) {
      drop()
      return
    }
    part = null
    const text = deps.continueText()
    followed.expect = normalized(text)
    followed.pendingHeader = true
    // after the tracker's idle listeners: the panel's next run must not start inside that loop
    queueMicrotask(() => {
      if (job === followed) send(text)
    })
  })

  return {
    start(p) {
      job = { id: p.handoffId, expect: normalized(p.text), pendingHeader: true }
      part = null
      send(p.text, p.displayText ?? p.text)
    },
    consumePreset() {
      const preset = buffered
      buffered = null
      return preset
    },
    onPreset(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    stream({ words, afterTools, uniwork }) {
      const followed = job
      // tool results continue (or resume) the part; nothing else changes
      if (!followed || words === null) return null
      if (uniwork && followed.pendingHeader && normalized(words).includes(followed.expect)) {
        part = { failed: false, openToolCalls: false, remaining: 0 }
        return followed.id
      }
      // the person asked something else; a question after tool results is the loop's own
      if (!afterTools) drop()
      return null
    },
    answered(id, ok, remaining) {
      if (!ok || !part || job?.id !== id) return
      job.pendingHeader = false
      part.remaining =
        remaining !== null && /^\d+$/.test(remaining.trim()) ? Number(remaining.trim()) : 0
    },
    ended({ failed, openToolCalls }) {
      if (!part) return
      if (failed) part.failed = true
      // the last stream decides: tool calls still waiting for their results
      part.openToolCalls = openToolCalls
    },
  }
}
