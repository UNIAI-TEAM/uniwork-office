import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { RunHistoryGroup } from '@genoffice/agent-core'
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Step, StepMap, StepResult } from '@tiptap/pm/transform'
import type { Node as PmNode, Schema } from '@tiptap/pm/model'
import { OP_META, type OpMeta } from './ops'

/**
 * One Ctrl/Cmd+Z per AI run.
 *
 * Every op of a run is its own transaction (ops.ts), and the editor's history would give each its
 * own undo step (it only joins edits that are close in time AND next to each other). While a run
 * is open (`begin` .. `end`, driven by the agent loop's run hooks) this plugin tells the history
 * to treat each of the run's edits as part of the run's open group: the first edit closes the
 * previous group (so the run never joins the user's own typing), the rest are marked as appended
 * transactions, which prosemirror-history always joins to the open group whatever the gap.
 *
 * A user edit in the middle of a run closes the group and the run's next edit opens a new one:
 * the history stays chronological, the user's words are never part of an AI step, and undoing the
 * run's pieces one by one never loses them. (Blocking the keyboard during a run would change how
 * the editor feels for something the edit fence and Stop already cover.)
 *
 * What lives outside the ProseMirror document rides the same step through `AiRunStep`, a step
 * that changes nothing in the document: it carries the properties block (frontmatter) before and
 * after, so undo/redo of the group re-applies it through `setRunFrontmatterSink`, and it tells the
 * panel which run was undone or redone (`onRunHistoryChange`), so the pictures that run saved
 * can be dropped the way Roll back drops them.
 */

interface RunState {
  runId: string
  /** the run's next edit must open a new history group (first edit, after a user edit or an undo) */
  fresh: boolean
  /** history items the run has produced so far */
  items: number
}

type RunMeta =
  | { type: 'begin'; runId: string }
  | { type: 'end'; runId: string }
  /** a transaction that belongs to the run's group but is not an op (marker, properties) */
  | { type: 'member' }

const runKey = new PluginKey<RunState | null>('aiRunHistory')

/** a step that leaves the document alone and carries what the document does not hold */
class AiRunStep extends Step {
  constructor(
    readonly runId: string,
    /** properties block (raw, fences included) before / after; applying the step sets `to` */
    readonly fm: { from: string; to: string } | null,
    /** true for the inverse a history undo applies, false for the original and for a redo */
    readonly reverted: boolean,
  ) {
    super()
  }
  apply(doc: PmNode): StepResult {
    return StepResult.ok(doc)
  }
  getMap(): StepMap {
    return StepMap.empty
  }
  invert(): Step {
    return new AiRunStep(
      this.runId,
      this.fm ? { from: this.fm.to, to: this.fm.from } : null,
      !this.reverted,
    )
  }
  map(): Step {
    return this
  }
  toJSON(): unknown {
    return { stepType: 'aiRun', runId: this.runId, fm: this.fm, reverted: this.reverted }
  }
  static fromJSON(
    _schema: Schema,
    json: { runId: string; fm: AiRunStep['fm']; reverted: boolean },
  ) {
    return new AiRunStep(json.runId, json.fm, json.reverted)
  }
}
Step.jsonID('aiRun', AiRunStep)

type Classified = 'ai' | 'user' | 'other'

function classify(tr: Transaction): Classified {
  if (tr.steps.length === 0 || tr.getMeta('addToHistory') === false) return 'other'
  if (isHistoryTransaction(tr)) return 'other'
  const run = tr.getMeta(runKey) as RunMeta | undefined
  if (run?.type === 'member') return 'ai'
  const op = tr.getMeta(OP_META) as OpMeta | undefined
  if (op) return op.source === 'ai' && !op.rollback ? 'ai' : 'other'
  return 'user'
}

function runSteps(tr: Transaction): AiRunStep[] {
  return tr.steps.filter((s): s is AiRunStep => s instanceof AiRunStep)
}

export interface RunHistoryChange {
  runId: string
  direction: 'undo' | 'redo'
}

interface RunHistoryStorage {
  listeners: Set<(change: RunHistoryChange) => void>
  frontmatterSink: ((raw: string) => void) | null
  redoGuard: ((runId: string) => boolean) | null
}

export const AiRunHistory = Extension.create<unknown, RunHistoryStorage>({
  name: 'aiRunHistory',

  addStorage() {
    return { listeners: new Set(), frontmatterSink: null, redoGuard: null }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin<RunState | null>({
        key: runKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(runKey) as RunMeta | undefined
            if (meta?.type === 'begin') return { runId: meta.runId, fresh: true, items: 0 }
            if (meta?.type === 'end') return null
            if (!value || tr.getMeta('appendedTransaction')) return value
            const kind = classify(tr)
            if (kind === 'ai') return { ...value, fresh: false, items: value.items + 1 }
            // a user edit or a history step in the middle of the run: its next edit starts a new group
            if (kind === 'user' || isHistoryTransaction(tr)) return { ...value, fresh: true }
            return value
          },
        },
        filterTransaction(tr, state: EditorState) {
          // a redo of a run whose pictures were discarded would bring back dead image links
          if (isHistoryTransaction(tr) && storage.redoGuard) {
            const redo = runSteps(tr).filter((s) => !s.reverted)
            if (redo.some((s) => storage.redoGuard?.(s.runId))) return false
          }
          const run = runKey.getState(state)
          if (!run || tr.getMeta('appendedTransaction')) return true
          const kind = classify(tr)
          if (kind === 'ai') {
            if (run.fresh) closeHistory(tr)
            // an appended transaction is always joined to the open history group
            else tr.setMeta('appendedTransaction', state.tr)
          } else if (kind === 'user') {
            closeHistory(tr)
          }
          return true
        },
      }),
    ]
  },

  onTransaction({ transaction, appendedTransactions }) {
    const storage = this.storage
    const history = isHistoryTransaction(transaction)
    const seen = new Set<string>()
    for (const tr of [transaction, ...(appendedTransactions ?? [])]) {
      const rollback = (tr.getMeta(OP_META) as OpMeta | undefined)?.rollback === true
      if (!history && !rollback) continue
      for (const step of runSteps(tr)) {
        if (step.fm) storage.frontmatterSink?.(step.fm.to)
        if (history && !seen.has(step.runId)) {
          seen.add(step.runId)
          const change: RunHistoryChange = {
            runId: step.runId,
            direction: step.reverted ? 'undo' : 'redo',
          }
          for (const listener of [...storage.listeners]) listener(change)
        }
      }
    }
  },
})

function storageOf(editor: Editor): RunHistoryStorage {
  return (editor.storage as unknown as { aiRunHistory: RunHistoryStorage }).aiRunHistory
}

export interface MarkdownRunHistory extends RunHistoryGroup {
  /**
   * the run changed the properties block: it rides the run's undo step. Only while a run is open
   * (a hand edit of the block is not part of any run), and only when the block really changed.
   */
  recordFrontmatter(before: string, after: string): void
  /** the panel refuses a redo of this run (its pictures are gone); null lifts the guard */
  refuseRedo(guard: ((runId: string) => boolean) | null): void
}

/** the run history group of this editor, to bind to the agent loop's onRunStart / onRunEnd */
export function runHistoryOf(editor: Editor): MarkdownRunHistory {
  const live = (): boolean => !editor.isDestroyed && !!editor.view
  const current = (): RunState | null => (live() ? (runKey.getState(editor.state) ?? null) : null)
  const send = (meta: RunMeta, steps: Step[] = []): void => {
    const tr = editor.state.tr.setMeta(runKey, meta)
    for (const step of steps) tr.step(step)
    editor.view.dispatch(tr)
  }
  return {
    get activeRunId() {
      return current()?.runId ?? null
    },
    begin(runId) {
      if (!live()) return
      send({ type: 'begin', runId })
    },
    end(runId) {
      const run = current()
      if (!run || run.runId !== runId) return
      // the group is whatever history items the run produced: a read-only run, or a stop before
      // any edit, produced none and leaves no step (the loop reports a tool cut off by Stop as
      // may-have-mutated, so `mutated` is not the test)
      if (run.items > 0) send({ type: 'member' }, [new AiRunStep(runId, null, false)])
      // close the group so the user's next keystroke is a step of its own, then leave the run
      const tr = editor.state.tr.setMeta(runKey, { type: 'end', runId } satisfies RunMeta)
      editor.view.dispatch(closeHistory(tr))
    },
    recordFrontmatter(before, after) {
      if (before === after || !current()) return
      send({ type: 'member' }, [
        new AiRunStep(current()!.runId, { from: before, to: after }, false),
      ])
    },
    refuseRedo(guard) {
      storageOf(editor).redoGuard = guard
    },
  }
}

/** undo / redo of a run's group, by run id (the panel drops or keeps what the run saved) */
export function onRunHistoryChange(
  editor: Editor,
  listener: (change: RunHistoryChange) => void,
): () => void {
  const { listeners } = storageOf(editor)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** where the properties block goes when an undo / redo of a run (or a failed batch) changes it */
export function setRunFrontmatterSink(editor: Editor, sink: ((raw: string) => void) | null): void {
  storageOf(editor).frontmatterSink = sink
}
