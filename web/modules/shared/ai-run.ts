/**
 * The frame's AI turn state for the host (X-02 `aiRun`) and for the new-version bar (S6).
 *
 * `running` is reported when the first AI stream of a turn starts and exactly one `idle` after the
 * last one ended (stream finished, failed, was stopped, or the page lost the AI bridge). The agent
 * loops of the renderers start a new stream for every tool step, so the idle is held back for a
 * short grace: a stream that starts inside it continues the same run (same run id) and no events
 * go out in between. A frame that unloads sends nothing; the host treats that as idle.
 */
import type { AiRunPayload } from '../../docs/protocol/types'

/** how long after the last stream ended the run still counts as running (next tool step) */
export const AI_RUN_IDLE_GRACE_MS = 1500

export interface AiRunTracker {
  /** a stream of the turn started; `cancel` stops it (the "stop to reload" choice) */
  begin(streamId: string, cancel?: () => void): void
  /** that stream is over, whatever the reason */
  end(streamId: string): void
  /** a turn is in progress (including the grace after its last stream) */
  running(): boolean
  /** called whenever `running()` flips; returns the unsubscribe */
  onChange(listener: (running: boolean) => void): () => void
  /** cancel every active stream and resolve once the run is idle */
  stop(): Promise<void>
  /** where `aiRun` events go (the protocol client); undefined = nobody listens */
  bind(report: ((payload: AiRunPayload) => void) | undefined): void
}

export interface AiRunTrackerOptions {
  report?: (payload: AiRunPayload) => void
  graceMs?: number
}

export function createAiRunTracker(opts: AiRunTrackerOptions = {}): AiRunTracker {
  let report = opts.report
  const graceMs = opts.graceMs ?? AI_RUN_IDLE_GRACE_MS
  const active = new Map<string, (() => void) | undefined>()
  const listeners = new Set<(running: boolean) => void>()
  let isRunning = false
  let runId = ''
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  /** stop() cancelled the streams: their end is the end of the run, no grace */
  let stopping = false

  function flip(next: boolean): void {
    if (next === isRunning) return
    isRunning = next
    try {
      report?.(next ? { state: 'running', run_id: runId } : { state: 'idle', run_id: runId })
    } catch (err) {
      console.warn('[office-web] aiRun report failed:', err)
    }
    for (const l of [...listeners]) {
      try {
        l(next)
      } catch (err) {
        console.error('[office-web] aiRun listener threw', err)
      }
    }
  }

  function settle(): void {
    timer = null
    stopping = false
    if (active.size === 0) flip(false)
  }

  const tracker: AiRunTracker = {
    begin(streamId, cancel) {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      active.set(streamId, cancel)
      if (!isRunning) {
        runId = `r${++seq}`
        flip(true)
      }
    },
    end(streamId) {
      if (!active.delete(streamId) || active.size > 0) return
      if (graceMs <= 0 || stopping) settle()
      else timer = setTimeout(settle, graceMs)
    },
    running: () => isRunning,
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    stop() {
      if (!isRunning) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const off = tracker.onChange((running) => {
          if (running) return
          off()
          resolve()
        })
        stopping = true
        for (const cancel of [...active.values()]) cancel?.()
        // nothing to cancel (the grace is all that is left): the run ends now
        if (active.size === 0) {
          if (timer !== null) clearTimeout(timer)
          settle()
        }
      })
    },
    bind(next) {
      report = next
    },
  }
  return tracker
}

/** the one tracker of this frame page: the AI bridge feeds it, the S6 bar reads it */
export const frameAiRun: AiRunTracker = createAiRunTracker()
