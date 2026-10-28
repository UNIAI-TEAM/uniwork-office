/**
 * A job the host hands to the AI panel (`ai.start`, UNI-2264), followed part by part.
 *
 * `start` keeps `{ handoffId, pendingHeader: true }` and sends the panel one preset (a listener
 * gets it at once; without one it waits for one `consumeAiPreset`). The first request of the
 * UniWork AI question that runs it carries `X-UniWork-AI-Handoff: <id>` (its run_expired / 429
 * resends too, never a tool-result request): the server expands the job into that question and
 * answers `X-UniWork-AI-Handoff-Remaining: <parts left after this one>`.
 *
 * When that run goes idle with no stream failed or stopped, its last answer complete (no tool call
 * left unanswered) and at least one part left, a short continuation preset goes out and the next
 * question carries the header again. A run the person starts themselves (a question that is not the
 * pending preset, or any run while one is pending) drops the job: no continuation, no header.
 * State lives in this frame page only; nothing is persisted.
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

export interface AiHandoff {
  /** `ai.start` accepted: follow this job (replaces one already followed) */
  start(job: AiStartPayload): void
  /** the preset that arrived while no listener was there, once */
  consumePreset(): AiPreset | null
  /** presets as they arrive; returns the unsubscribe */
  onPreset(listener: (preset: AiPreset) => void): () => void
  /** a UniWork AI question goes out (its user words): the handoff id it carries, or null */
  question(words: string): string | null
  /** `X-UniWork-AI-Handoff-Remaining` of the answer to a question that carried the id */
  remaining(header: string | null): void
  /** a UniWork AI stream of the run ended: failed or stopped, or with its tool calls unanswered */
  ended(outcome: { failed: boolean; openToolCalls: boolean }): void
}

interface Job {
  id: string
  /** the preset text its question must contain */
  expect: string
  pendingHeader: boolean
}

interface Run {
  /** the job followed when the run started; a run from before it is not judged */
  job: Job | null
  /** its first question carried the handoff id */
  owned: boolean
  failed: boolean
  openToolCalls: boolean
  remaining: number
}

export function createAiHandoff(deps: {
  /** the frame's turn tracker: runs start and go idle with it (absent = no header, no continuation) */
  aiRun?: Pick<AiRunTracker, 'onChange'>
  /** the continuation text in the viewer's language */
  continueText(): string
}): AiHandoff {
  let job: Job | null = null
  let buffered: AiPreset | null = null
  let run: Run | null = null
  const listeners = new Set<(preset: AiPreset) => void>()

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

  function idle(r: Run): void {
    const followed = job
    if (!followed || r.job !== followed) return
    if (!r.owned || r.failed || r.openToolCalls || r.remaining < 1) {
      job = null
      return
    }
    const text = deps.continueText()
    followed.expect = text.trim()
    followed.pendingHeader = true
    // after the tracker's idle listeners: the panel's next run must not start inside that loop
    queueMicrotask(() => {
      if (job === followed) send(text)
    })
  }

  deps.aiRun?.onChange((running) => {
    if (running) {
      run = { job, owned: false, failed: false, openToolCalls: false, remaining: 0 }
      return
    }
    const r = run
    run = null
    if (r) idle(r)
  })

  return {
    start(p) {
      job = { id: p.handoffId, expect: p.text.trim(), pendingHeader: true }
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
    question(words) {
      const followed = job
      if (!followed || !run || run.job !== followed || run.owned) return null
      if (followed.pendingHeader && words.includes(followed.expect)) {
        followed.pendingHeader = false
        run.owned = true
        return followed.id
      }
      // the person asked something else
      job = null
      return null
    },
    remaining(header) {
      if (!run?.owned) return
      run.remaining = header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) : 0
    },
    ended({ failed, openToolCalls }) {
      if (!run) return
      if (failed) run.failed = true
      // the last stream decides: a Stop while tools ran leaves its calls unanswered
      run.openToolCalls = openToolCalls
    },
  }
}
