import { legacyProgressDetailKey } from './legacy-open'
import type { LegacyOpenStringKey } from './legacy-open-strings'

export const LEGACY_PROGRESS_DELAY_MS = 600

export interface LegacyProgressMessageBoxOptions {
  readonly type: 'info'
  readonly message: string
  readonly detail: string
  readonly buttons: string[]
  readonly cancelId: number
  readonly noLink: boolean
  readonly signal: AbortSignal
}

export interface LegacyProgressMessageBoxResult {
  readonly response: number
}

export type LegacyProgressTimerHandle = unknown

export interface LegacyProgressDeps {
  showMessageBox(options: LegacyProgressMessageBoxOptions): Promise<LegacyProgressMessageBoxResult>
  /**
   * Optional explicit closer for platforms (such as Linux/GTK in Electron) where
   * `AbortSignal` on `dialog.showMessageBox` does not close the native dialog window.
   */
  closeBox?(signal: AbortSignal): void
  setProgressBar(value: number, options?: { mode: 'indeterminate' }): void
  t(key: LegacyOpenStringKey, params?: Record<string, string | number>): string
  cancelLabel(): string
  delayMs?: number
  setTimer?(cb: () => void, ms: number): LegacyProgressTimerHandle
  clearTimer?(handle: LegacyProgressTimerHandle): void
}

interface ActiveProgressJob {
  readonly fileName: string
  readonly cancel: () => void
  finished: boolean
}

interface ProgressSession {
  readonly jobs: ActiveProgressJob[]
  readonly box: AbortController
  timer: LegacyProgressTimerHandle | null
  boxShown: boolean
  boxSettled: boolean
  abortedByUs: boolean
}

/**
 * Shared progress box and taskbar indicator for concurrent legacy/ODF conversions.
 *
 * One modal progress box is shown at a time: while a session is open (waiting for the
 * delay or showing the box), later conversions join the same session instead of opening
 * stacked modal dialogs that would dismiss or cancel each other. Clicking Cancel in the
 * box cancels every joined job that is still running; any other resolution (or our own
 * `AbortController` abort when the last job finishes) cancels nothing. The taskbar/dock
 * progress bar stays indeterminate until the last job ends.
 */
export function createLegacyProgress(
  deps: LegacyProgressDeps,
): (fileName: string, cancel: () => void) => () => void {
  const delayMs = deps.delayMs ?? LEGACY_PROGRESS_DELAY_MS
  const setTimer = deps.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms))
  const clearTimer =
    deps.clearTimer ??
    ((handle: LegacyProgressTimerHandle) => clearTimeout(handle as NodeJS.Timeout))

  let session: ProgressSession | null = null

  function startSession(firstJob: ActiveProgressJob): ProgressSession {
    const current: ProgressSession = {
      jobs: [firstJob],
      box: new AbortController(),
      timer: null,
      boxShown: false,
      boxSettled: false,
      abortedByUs: false,
    }
    session = current
    deps.setProgressBar(2, { mode: 'indeterminate' })

    current.timer = setTimer(() => {
      current.timer = null
      if (session !== current || current.abortedByUs) return
      const activeJob = current.jobs.find((j) => !j.finished)
      if (!activeJob) return
      const fileName = activeJob.fileName
      const cancelId = 0
      const options: LegacyProgressMessageBoxOptions = {
        type: 'info',
        message: deps.t('legacyConvertingMsg', { name: fileName }),
        detail: deps.t(legacyProgressDetailKey(fileName)),
        buttons: [deps.cancelLabel()],
        cancelId,
        noLink: true,
        signal: current.box.signal,
      }
      current.boxShown = true
      const shown = deps.showMessageBox(options)
      void Promise.resolve(shown)
        .then((res) => {
          current.boxSettled = true
          if (current.abortedByUs || current.box.signal.aborted) return
          if (!res || typeof res.response !== 'number' || res.response !== cancelId) return
          if (session === current) {
            session = null
            deps.setProgressBar(-1)
          }
          for (const job of [...current.jobs]) {
            if (!job.finished) {
              job.finished = true
              job.cancel()
            }
          }
        })
        .catch(() => {
          current.boxSettled = true
        })
    }, delayMs)

    return current
  }

  return function beginLegacyProgress(fileName: string, cancel: () => void): () => void {
    const job: ActiveProgressJob = {
      fileName,
      cancel,
      finished: false,
    }

    const current = session ?? startSession(job)
    if (current.jobs[0] !== job) {
      current.jobs.push(job)
    }

    return () => {
      if (job.finished) return
      job.finished = true
      if (current.jobs.some((j) => !j.finished)) return
      current.abortedByUs = true
      if (current.timer !== null) {
        clearTimer(current.timer)
        current.timer = null
      }
      current.box.abort()
      if (current.boxShown && !current.boxSettled) {
        deps.closeBox?.(current.box.signal)
      }
      if (session === current) {
        session = null
        deps.setProgressBar(-1)
      }
    }
  }
}
