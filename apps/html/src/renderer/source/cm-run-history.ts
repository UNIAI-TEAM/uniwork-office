import {
  Annotation,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
} from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'

/**
 * One undo step per AI run in the source pane.
 *
 * CodeMirror's history joins two edits into one event only when they are close in time (500 ms),
 * next to each other and not separated by a selection change, so the edits of a run (each tool
 * call lands its own patches, seconds apart, anywhere in the page) would each be a step. While a
 * run is open (`begin` .. `end`, driven by the agent loop's run hooks) the run's edits carry
 * `aiRunEdit` and the run's start time as their `Transaction.time`, and `joinRunEdits` (the
 * history's `joinToEvent`) lets them join the open event whatever their position; the first one
 * isolates itself from whatever came before.
 *
 * Anything else the run's window sees stays out of the run's step: a user edit isolates itself
 * (and the run's next edit opens a fresh event), so the history stays chronological and typing is
 * never undone with the AI's work; a caret move is kept out of the history while a run is open
 * (a selection change after an event is what stops further edits joining it).
 */

/** marks an edit as made by the open AI run */
export const aiRunEdit = Annotation.define<boolean>()

const runEffect = StateEffect.define<{ id: string; time: number } | null>()

interface RunState {
  id: string
  /** the run's edits all carry this time, so they are always inside the history's grouping delay */
  time: number
  /** the run's next edit must open a new history event (first edit, or a user edit came between) */
  fresh: boolean
}

export const runField = StateField.define<RunState | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(runEffect)) {
        value = effect.value ? { ...effect.value, fresh: true } : null
      }
    }
    if (value && tr.docChanged && tr.annotation(Transaction.addToHistory) !== false) {
      return { ...value, fresh: !tr.annotation(aiRunEdit) }
    }
    return value
  },
})

/** history `joinToEvent`: adjacent edits as ever, plus every edit of an open run */
export const joinRunEdits = (tr: Transaction, adjacent: boolean): boolean =>
  adjacent || tr.annotation(aiRunEdit) === true

export const runHistoryExtension: Extension = [
  runField,
  EditorState.transactionFilter.of((tr) => {
    const run = tr.startState.field(runField, false)
    if (!run) return tr
    if (!tr.docChanged) {
      return tr.selection && tr.annotation(Transaction.addToHistory) !== false
        ? [tr, { annotations: Transaction.addToHistory.of(false) }]
        : tr
    }
    if (tr.annotation(Transaction.addToHistory) === false) return tr
    if (tr.annotation(aiRunEdit) && !run.fresh) return tr
    return [tr, { annotations: isolateHistory.of('before') }]
  }),
]

/** the annotations an AI edit carries while a run is open (empty otherwise) */
export function runEditAnnotations(state: EditorState) {
  const run = state.field(runField, false)
  return run ? [aiRunEdit.of(true), Transaction.time.of(run.time)] : []
}

export function openRunId(state: EditorState): string | null {
  return state.field(runField, false)?.id ?? null
}

export function beginRunEffect(id: string) {
  return {
    effects: runEffect.of({ id, time: Date.now() }),
    annotations: isolateHistory.of('full'),
  }
}

export function endRunEffect() {
  return { effects: runEffect.of(null), annotations: isolateHistory.of('full') }
}
