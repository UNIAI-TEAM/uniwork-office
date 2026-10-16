import type { RunHistoryGroup } from '@genoffice/agent-core'
import type { EditSnapshot } from '../edit-state'

/**
 * Where an AI run stands in the undo history, for its "Undo this run" button:
 * ready = the run is the latest undo step; later = something was done on top of it;
 * undone = Ctrl/Cmd+Z (or the button) took it back and a redo would re-apply it;
 * none = no step holds it (read-only run, saved since, pushed off the stack).
 */
export type RunUndoState = 'ready' | 'later' | 'undone' | 'none'

/** What the AI panel needs from the app's undo history */
export interface RunUndoDeps {
  /** the editor's undo group: opened when a run starts, closed when it ends */
  runHistory?: RunHistoryGroup
  runUndoState?(runId: string): RunUndoState
  /** undo exactly that run; false when it is not the latest step any more */
  undoRun?(runId: string): boolean
}

/** a bucket the run did not touch keeps its reference, so reference equality is "unchanged" */
export function sameEditSnapshot(a: EditSnapshot, b: EditSnapshot): boolean {
  return (Object.keys(a) as Array<keyof EditSnapshot>).every((key) => Object.is(a[key], b[key]))
}

const DEFAULT_LIMIT = 50

/**
 * The undo/redo stacks of unsaved edits, with one change from a plain snapshot stack: while an
 * AI run is open its tools push nothing, and the run's end leaves ONE entry (the document as it
 * was when the run started) when the document really changed. One Ctrl/Cmd+Z then undoes the
 * whole run, however many changes it made, and a long run can no longer push the pre-run state
 * off the capped stack.
 */
export class EditHistory<S extends object> {
  private undoList: S[] = []
  private redoList: S[] = []
  /** snapshot -> run whose undo it is; carried across undo/redo so the run stays addressable */
  private readonly marks = new WeakMap<S, string>()
  private run: { id: string; base: S; voided: boolean } | null = null
  /** how many AI tool calls are executing right now; their writes are the run's own */
  private aiDepth = 0
  private readonly limit: number

  constructor(
    private readonly opts: {
      same: (a: S, b: S) => boolean
      onChange?: () => void
      limit?: number
    },
  ) {
    this.limit = opts.limit ?? DEFAULT_LIMIT
  }

  get undoStack(): readonly S[] {
    return this.undoList
  }

  get redoStack(): readonly S[] {
    return this.redoList
  }

  get activeRunId(): string | null {
    return this.run?.id ?? null
  }

  /** the ribbon button / shortcut can act: something to undo and no run in flight */
  get canUndo(): boolean {
    return this.undoList.length > 0 && this.run === null
  }

  get canRedo(): boolean {
    return this.redoList.length > 0 && this.run === null
  }

  /** an AI run is open: hand edits are paused (the notice the UI shows) */
  get runOpen(): boolean {
    return this.run !== null
  }

  /**
   * May a hand edit go ahead? Not while a run is open, unless the caller is one of the run's
   * own tools (asAi): a hand edit folded into the run's single entry would be thrown away by
   * "Undo this run" without a trace.
   */
  mayEdit(): boolean {
    return this.run === null || this.aiDepth > 0
  }

  /** run an AI tool call: its edits count as the run's until a returned promise settles */
  asAi<T>(fn: () => T): T {
    this.aiDepth++
    let result: T
    try {
      result = fn()
    } catch (error) {
      this.aiDepth--
      throw error
    }
    if (result instanceof Promise) {
      return result.finally(() => {
        this.aiDepth--
      }) as T
    }
    this.aiDepth--
    return result
  }

  /** the tool api of the AI panel with every function run as the AI; other values pass through */
  scopeApi<A extends object>(api: A): A {
    const scoped: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(api)) {
      scoped[key] =
        typeof value === 'function'
          ? (...args: unknown[]) =>
              this.asAi(() => (value as (...a: unknown[]) => unknown)(...args))
          : value
    }
    return scoped as A
  }

  /** the document is about to change: remember how it is now (ignored inside an AI run) */
  push(snap: S): void {
    if (this.run) return
    this.undoList = [...this.undoList.slice(-(this.limit - 1)), snap]
    this.redoList = []
    this.opts.onChange?.()
  }

  /** restores the snapshot to apply, or null (nothing to undo, or a run is open) */
  undo(current: S): S | null {
    if (this.run) return null
    const top = this.undoList[this.undoList.length - 1]
    if (!top) return null
    this.carryMark(top, current)
    this.redoList = [...this.redoList, current]
    this.undoList = this.undoList.slice(0, -1)
    this.opts.onChange?.()
    return top
  }

  redo(current: S): S | null {
    if (this.run) return null
    const top = this.redoList[this.redoList.length - 1]
    if (!top) return null
    this.carryMark(top, current)
    this.undoList = [...this.undoList, current]
    this.redoList = this.redoList.slice(0, -1)
    this.opts.onChange?.()
    return top
  }

  /** the document was reloaded from disk: neither stack is valid any more, nor is an open run's base */
  clear(): void {
    this.undoList = []
    this.redoList = []
    if (this.run) this.run.voided = true
    this.opts.onChange?.()
  }

  beginRun(runId: string, base: S): void {
    this.run = { id: runId, base, voided: false }
    this.opts.onChange?.()
  }

  /** closes the run: one entry when it changed the document, none otherwise */
  endRun(runId: string, mutated: boolean, current: S): void {
    const run = this.run
    if (!run || run.id !== runId) return
    this.run = null
    if (mutated && !run.voided && !this.opts.same(run.base, current)) {
      this.marks.set(run.base, runId)
      this.undoList = [...this.undoList.slice(-(this.limit - 1)), run.base]
      this.redoList = []
    }
    this.opts.onChange?.()
  }

  runState(runId: string): RunUndoState {
    const at = this.undoList.findIndex((s) => this.marks.get(s) === runId)
    if (at >= 0) return at === this.undoList.length - 1 ? 'ready' : 'later'
    if (this.redoList.some((s) => this.marks.get(s) === runId)) return 'undone'
    return 'none'
  }

  /** undo exactly this run: only while it is the latest step */
  undoRun(runId: string, current: S): S | null {
    return this.runState(runId) === 'ready' ? this.undo(current) : null
  }

  private carryMark(from: S, to: S): void {
    const runId = this.marks.get(from)
    if (runId !== undefined) this.marks.set(to, runId)
  }
}
