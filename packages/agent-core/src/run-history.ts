import type { AgentLoopEvents } from './loop'

/**
 * Editor-side undo grouping for one AI run: the editor (ProseMirror, CodeMirror,
 * a pushUndo stack) folds every change made between begin() and end() into a
 * single undo step, so one Undo reverts the whole run.
 */
export interface RunHistoryGroup {
  /** open a group: every editor change until end() becomes ONE undo step */
  begin(runId: string): void
  /** close the group; mutated=false -> no undo step is left behind */
  end(runId: string, mutated: boolean): void
  /** id of the open group, or null */
  readonly activeRunId: string | null
}

/** binds a group to loop events: returns {onRunStart, onRunEnd} to spread into AgentLoopEvents */
export function runHistoryEvents(
  group: RunHistoryGroup,
): Pick<AgentLoopEvents<unknown>, 'onRunStart' | 'onRunEnd'> {
  return {
    onRunStart: (runId) => group.begin(runId),
    onRunEnd: (runId, end) => group.end(runId, end.mutated),
  }
}

/** test fake: records begin/end calls in order, flags unpaired or nested calls */
export function createFakeRunHistoryGroup(): RunHistoryGroup & {
  calls: Array<['begin' | 'end', string, boolean?]>
  errors: string[]
} {
  let active: string | null = null
  const calls: Array<['begin' | 'end', string, boolean?]> = []
  const errors: string[] = []
  return {
    calls,
    errors,
    get activeRunId() {
      return active
    },
    begin(runId) {
      calls.push(['begin', runId])
      if (active !== null) errors.push(`begin ${runId} while ${active} is still open`)
      active = runId
    },
    end(runId, mutated) {
      calls.push(['end', runId, mutated])
      if (active !== runId) errors.push(`end ${runId} without a matching begin (open: ${active})`)
      else active = null
    },
  }
}
