import {
  COMPLETED_VIA_TOOLS_TEXT,
  createTextNoticeSurface,
  noticePatch,
  type AgentStreamNotice,
  type NoticeTranslate,
} from '@genoffice/agent-core'

/**
 * The notice state of one Sheets AI run. The chat message here is a single text, so the UniWork AI
 * notices (a Retry-After wait, a restart, a provider boundary, dropped calls, "off") are folded into
 * it by the shared text surface; this adds the run's last streamed text (the fallback of a final
 * turn without prose). App.tsx only forwards the loop's events; the rules live here so a test can
 * drive them without mounting the app.
 */

/** the display strings of the run's closing lines (translated by the caller) */
export interface RunCopy {
  stopped: string
  noSummary: string
  noAction: string
  turnLimit: string
  truncated: string
}

export interface RunFinish {
  /** the loop's final text (may be the COMPLETED_VIA_TOOLS placeholder) */
  text: string
  cancelled: boolean
  turnLimit: boolean
  truncated: boolean
  /** the run's tool summaries, one per line, used when the model finished with no prose */
  toolSummaries: string
  /** a tool of the run changed the workbook */
  mutated: boolean
  copy: RunCopy
}

export interface RunNotices {
  /** streamed (cumulative) answer text: ends a wait; returns the text of the message */
  text(raw: string): string
  /** a transport notice; the new text of the message, or null when nothing changed */
  notice(notice: AgentStreamNotice, tr: NoticeTranslate, moduleName: string): string | null
  /** the transport restarts the turn: what it streamed so far is dropped, including the fallback text */
  reset(): string
  /**
   * what a screen reader should hear now: the latest notice or wait line, '' when none. The panel keeps
   * one persistent live node for it, because a notice folded into the message text mounts with its
   * content already in it and is often not announced.
   */
  announcement(): string
  /** the notes are the whole answer (restarted, or UniWork AI off) */
  quiet(): boolean
  /** the run ended: `display` is the message text (notes above the answer), `persisted` the bare answer */
  finish(done: RunFinish): { display: string; persisted: string }
  /** a new run starts */
  clear(): void
}

export function createRunNotices(): RunNotices {
  const surface = createTextNoticeSurface()
  // last non-empty streamed text of the run: a final empty turn falls back to it instead of wiping
  // the model's own summary from the tool-call turn
  let lastText = ''
  let announced = ''
  let announcedIsWait = false
  return {
    text(raw) {
      if (raw) lastText = raw
      // the wait is over once text streams in; a note stays announced until the run ends
      if (raw && announcedIsWait) announced = ''
      return surface.text(raw)
    },
    notice(notice, tr, moduleName) {
      const shown = surface.notice(notice, tr, moduleName)
      if (shown !== null) {
        const patch = noticePatch({}, notice, tr, moduleName)
        if (patch?.waitLine) {
          announced = patch.waitLine
          announcedIsWait = true
        } else if (patch?.notes?.length) {
          announced = patch.notes.map((n) => n.text).join(' ')
          announcedIsWait = false
        }
      }
      return shown
    },
    announcement: () => announced,
    reset() {
      // the dropped partial answer must not come back as the fallback of a tools-only resend
      lastText = ''
      if (announcedIsWait) announced = ''
      return surface.reset()
    },
    quiet: () => surface.quiet(),
    finish({ text, cancelled, turnLimit, truncated, toolSummaries, mutated, copy }) {
      // a cancelled run keeps the "stopped" notice: earlier narration or tool summaries would make an
      // aborted run read as completed
      const prose =
        text && text !== COMPLETED_VIA_TOOLS_TEXT
          ? text
          : cancelled
            ? ''
            : lastText || toolSummaries || text
      // a final empty turn must not claim completion: reuse the model's last streamed text; with none,
      // only a mutating run gets the "done" phrasing
      const fallback = cancelled
        ? copy.stopped
        : lastText || toolSummaries || (mutated ? copy.noSummary : copy.noAction)
      // a restarted conversation or UniWork AI being off ends the turn on purpose: the note is the whole reply
      const base = turnLimit
        ? [prose, copy.turnLimit].filter(Boolean).join('\n\n')
        : prose || (surface.quiet() ? '' : fallback)
      const persisted = truncated ? [base, copy.truncated].filter(Boolean).join('\n\n') : base
      announced = ''
      return { display: surface.compose(persisted), persisted }
    },
    clear() {
      lastText = ''
      announced = ''
      announcedIsWait = false
      surface.clear()
    },
  }
}
