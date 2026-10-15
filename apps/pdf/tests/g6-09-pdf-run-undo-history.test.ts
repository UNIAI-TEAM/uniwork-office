// One undo step per AI run in the PDF editor (G6-09 W7). The history is the real
// EditHistory the app drives; `world` below plays the part of App.tsx: every edit tool
// pushes a snapshot before it changes the document (pushUndo), Ctrl/Cmd+Z restores the
// popped snapshot, and the loop's run hooks open and close the group.
import { describe, expect, it } from 'vitest'
import { EditHistory, sameEditSnapshot } from '../src/renderer/ai/edit-history'
import type { EditSnapshot } from '../src/renderer/edit-state'

interface Snap {
  items: string[]
}

function world(initial: string[] = []) {
  let items = initial
  let changes = 0
  const history = new EditHistory<Snap>({
    same: (a, b) => a.items === b.items,
    onChange: () => {
      changes++
    },
  })
  const snap = (): Snap => ({ items })
  return {
    history,
    get items() {
      return items
    },
    get changes() {
      return changes
    },
    /** one edit (a tool call or a user action): pushUndo, then change the document */
    edit(item: string) {
      history.push(snap())
      items = [...items, item]
    },
    beginRun: (id: string) => history.beginRun(id, snap()),
    endRun: (id: string, mutated: boolean) => history.endRun(id, mutated, snap()),
    /** Ctrl/Cmd+Z */
    ctrlZ() {
      const restore = history.undo(snap())
      if (restore) items = restore.items
      return restore !== null
    },
    /** Ctrl/Cmd+Shift+Z */
    redo() {
      const restore = history.redo(snap())
      if (restore) items = restore.items
      return restore !== null
    },
  }
}

describe('pdf edit history: one undo step per AI run', () => {
  it('a run with three mutating tools is one step: one Ctrl/Cmd+Z restores the pre-run document', () => {
    const w = world(['user-a'])
    w.edit('user-b')
    w.beginRun('r1')
    w.edit('ai-1')
    w.edit('ai-2')
    w.edit('ai-3')
    w.endRun('r1', true)
    expect(w.items).toEqual(['user-a', 'user-b', 'ai-1', 'ai-2', 'ai-3'])
    expect(w.history.undoStack).toHaveLength(2) // the user edit + the run
    expect(w.ctrlZ()).toBe(true)
    expect(w.items).toEqual(['user-a', 'user-b'])
    // the step below is the user's own edit, untouched
    expect(w.ctrlZ()).toBe(true)
    expect(w.items).toEqual(['user-a'])
  })

  it('redo re-applies the whole run in one step', () => {
    const w = world()
    w.beginRun('r1')
    w.edit('ai-1')
    w.edit('ai-2')
    w.endRun('r1', true)
    w.ctrlZ()
    expect(w.items).toEqual([])
    expect(w.redo()).toBe(true)
    expect(w.items).toEqual(['ai-1', 'ai-2'])
    expect(w.ctrlZ()).toBe(true)
    expect(w.items).toEqual([])
  })

  it('a run with 60 changes keeps the pre-run state one step away and the older steps in place', () => {
    const w = world()
    for (let i = 0; i < 10; i++) w.edit(`user-${i}`)
    w.beginRun('big')
    for (let i = 0; i < 60; i++) w.edit(`ai-${i}`)
    w.endRun('big', true)
    expect(w.history.undoStack).toHaveLength(11)
    expect(w.items).toHaveLength(70)
    expect(w.ctrlZ()).toBe(true)
    expect(w.items).toHaveLength(10)
    expect(w.items.at(-1)).toBe('user-9')
    expect(w.history.undoStack).toHaveLength(10)
  })

  it('a run does not push its tools one by one: the stack stays empty until the run ends', () => {
    const w = world()
    w.beginRun('r1')
    w.edit('ai-1')
    expect(w.history.undoStack).toHaveLength(0)
    expect(w.history.canUndo).toBe(false)
    w.endRun('r1', true)
    expect(w.history.undoStack).toHaveLength(1)
    expect(w.history.canUndo).toBe(true)
  })

  it('a read-only run leaves no entry', () => {
    const w = world(['user-a'])
    w.edit('user-b')
    w.beginRun('r1')
    w.endRun('r1', false)
    expect(w.history.undoStack).toHaveLength(1)
    expect(w.history.runState('r1')).toBe('none')
  })

  it('a stopped run flagged mutated but with an unchanged document leaves no entry', () => {
    const w = world(['user-a'])
    w.beginRun('r1')
    w.endRun('r1', true)
    expect(w.history.undoStack).toHaveLength(0)
    expect(w.history.runState('r1')).toBe('none')
  })

  it('a new edit after a run clears redo, like any other edit', () => {
    const w = world()
    w.beginRun('r1')
    w.edit('ai-1')
    w.endRun('r1', true)
    w.ctrlZ()
    expect(w.history.redoStack).toHaveLength(1)
    w.edit('user-x')
    expect(w.history.redoStack).toHaveLength(0)
  })

  it('Ctrl/Cmd+Z and redo are held back while a run is open', () => {
    const w = world()
    w.edit('user-a')
    w.beginRun('r1')
    w.edit('ai-1')
    expect(w.history.canUndo).toBe(false)
    expect(w.ctrlZ()).toBe(false)
    expect(w.items).toEqual(['user-a', 'ai-1'])
    w.endRun('r1', true)
    expect(w.ctrlZ()).toBe(true)
    expect(w.items).toEqual(['user-a'])
  })

  it('a save-reload in the middle of a run drops the pre-run base instead of resurrecting saved edits', () => {
    const w = world()
    w.beginRun('r1')
    w.edit('ai-1')
    w.history.clear() // the save reload clears both stacks
    w.edit('ai-2')
    w.endRun('r1', true)
    expect(w.history.undoStack).toHaveLength(0)
    expect(w.history.runState('r1')).toBe('none')
  })

  it('the history change callback fires when the stacks move', () => {
    const w = world()
    const before = w.changes
    w.beginRun('r1')
    w.edit('ai-1')
    w.endRun('r1', true)
    expect(w.changes).toBeGreaterThan(before)
    const mid = w.changes
    w.ctrlZ()
    expect(w.changes).toBeGreaterThan(mid)
  })
})

describe('pdf edit history: hand edits are paused while a run is open (RFB-2)', () => {
  /** App.tsx applyEditOps: a hand edit asks the history first, the run's own tools go through asAi */
  function guarded(initial: string[] = []) {
    const w = world(initial)
    return Object.assign(Object.create(w) as typeof w, {
      /** a move / annotate / delete by hand: refused while a run is open */
      handEdit(item: string): boolean {
        if (!w.history.mayEdit()) return false
        w.edit(item)
        return true
      },
      /** the same write path, reached from an AI tool */
      aiEdit(item: string) {
        w.history.asAi(() => w.edit(item))
      },
    })
  }

  it('refuses a hand edit during a run and the run entry still restores the exact pre-run document', () => {
    const w = guarded(['user-a'])
    w.beginRun('r1')
    w.aiEdit('ai-1')
    expect(w.handEdit('user-during')).toBe(false)
    w.aiEdit('ai-2')
    w.endRun('r1', true)
    expect(w.items).toEqual(['user-a', 'ai-1', 'ai-2'])
    expect(w.ctrlZ()).toBe(true)
    expect(w.items).toEqual(['user-a'])
  })

  it('a read-only run still refuses a hand edit and leaves no entry', () => {
    const w = guarded(['user-a'])
    w.beginRun('r1')
    expect(w.handEdit('user-during')).toBe(false)
    w.endRun('r1', false)
    expect(w.items).toEqual(['user-a'])
    expect(w.history.undoStack).toHaveLength(0)
  })

  it('lets hand edits through again once the run has ended, as their own undo step', () => {
    const w = guarded()
    w.beginRun('r1')
    w.aiEdit('ai-1')
    w.endRun('r1', true)
    expect(w.handEdit('user-after')).toBe(true)
    expect(w.history.undoStack).toHaveLength(2)
    w.ctrlZ()
    expect(w.items).toEqual(['ai-1'])
  })

  it('treats an async AI tool as the AI until its promise settles, and a hand edit after that as refused', async () => {
    const w = guarded()
    w.beginRun('r1')
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const tool = w.history.asAi(async () => {
      await gate
      w.edit('ai-late') // after an await, still the tool's write
    })
    release()
    await tool
    expect(w.items).toEqual(['ai-late'])
    expect(w.handEdit('user-during')).toBe(false)
    w.endRun('r1', true)
    expect(w.items).toEqual(['ai-late'])
  })

  it('releases the AI scope when the tool throws', () => {
    const w = guarded()
    w.beginRun('r1')
    expect(() =>
      w.history.asAi(() => {
        throw new Error('tool failed')
      }),
    ).toThrow('tool failed')
    expect(w.handEdit('user-during')).toBe(false)
  })

  it('scopeApi wraps every function of the tool api and passes plain values through', async () => {
    const w = guarded()
    w.beginRun('r1')
    const api = w.history.scopeApi({
      label: 'x',
      sync: () => w.history.mayEdit(),
      later: async () => {
        await Promise.resolve()
        return w.history.mayEdit()
      },
    })
    expect(api.label).toBe('x')
    expect(api.sync()).toBe(true)
    expect(await api.later()).toBe(true)
    expect(w.history.mayEdit()).toBe(false)
  })

  it('reports the open run for the paused notice, and no run once it ended', () => {
    const w = guarded()
    expect(w.history.runOpen).toBe(false)
    w.beginRun('r1')
    expect(w.history.runOpen).toBe(true)
    w.endRun('r1', false)
    expect(w.history.runOpen).toBe(false)
    expect(w.history.mayEdit()).toBe(true)
  })
})

describe('pdf edit history: the state of a run for its Undo this run button', () => {
  it('is ready while the run is the latest step', () => {
    const w = world(['user-a'])
    w.beginRun('r1')
    w.edit('ai-1')
    w.endRun('r1', true)
    expect(w.history.runState('r1')).toBe('ready')
  })

  it('turns to later once the user edits on top, and back to ready when that edit is undone', () => {
    const w = world()
    w.beginRun('r1')
    w.edit('ai-1')
    w.endRun('r1', true)
    w.edit('user-x')
    expect(w.history.runState('r1')).toBe('later')
    w.ctrlZ()
    expect(w.history.runState('r1')).toBe('ready')
  })

  it('an older run is later once a newer run exists, the newer one is ready', () => {
    const w = world()
    w.beginRun('r1')
    w.edit('ai-1')
    w.endRun('r1', true)
    w.beginRun('r2')
    w.edit('ai-2')
    w.endRun('r2', true)
    expect(w.history.runState('r1')).toBe('later')
    expect(w.history.runState('r2')).toBe('ready')
  })

  it('is undone after Ctrl/Cmd+Z took the run back, and ready again after a redo', () => {
    const w = world()
    w.beginRun('r1')
    w.edit('ai-1')
    w.endRun('r1', true)
    w.ctrlZ()
    expect(w.history.runState('r1')).toBe('undone')
    w.redo()
    expect(w.history.runState('r1')).toBe('ready')
  })

  it('undoRun takes exactly that run back while it is the latest step, and refuses otherwise', () => {
    const w = world(['user-a'])
    w.beginRun('r1')
    w.edit('ai-1')
    w.endRun('r1', true)
    w.edit('user-x')
    // later edits exist: refused, nothing moves
    expect(w.history.runState('r1')).toBe('later')
    const stackBefore = w.history.undoStack.length
    expect(w.history.undoRun('r1', { items: w.items })).toBeNull()
    expect(w.history.undoStack).toHaveLength(stackBefore)
    w.ctrlZ()
    const restore = w.history.undoRun('r1', { items: w.items })
    expect(restore?.items).toEqual(['user-a'])
  })

  it('is none for an unknown run and for a run pushed off the 50-step limit', () => {
    const w = world()
    w.beginRun('old')
    w.edit('ai-1')
    w.endRun('old', true)
    for (let i = 0; i < 60; i++) w.edit(`user-${i}`)
    expect(w.history.undoStack).toHaveLength(50)
    expect(w.history.runState('old')).toBe('none')
    expect(w.history.runState('never-existed')).toBe('none')
  })
})

describe('sameEditSnapshot', () => {
  const base = (): EditSnapshot => ({
    markups: [],
    annotDeletes: [],
    noteEdits: [],
    drawings: [],
    textEdits: [],
    textInserts: [],
    imageEdits: [],
    stampCfg: null,
    formEdits: new Map(),
    rotations: new Map(),
    deleted: new Set(),
    order: null,
    metadata: null,
  })

  it('treats a snapshot with untouched buckets as unchanged', () => {
    const a = base()
    expect(sameEditSnapshot(a, { ...a })).toBe(true)
  })

  it('sees a replaced bucket as a change', () => {
    const a = base()
    expect(sameEditSnapshot(a, { ...a, textInserts: [] })).toBe(false)
    expect(sameEditSnapshot(a, { ...a, deleted: new Set([1]) })).toBe(false)
  })
})
