// One Ctrl/Cmd+Z per AI run in markdown (G6-09 W4): every history item of a run folds into ONE
// undo step, whatever the gap between its ops; redo re-applies the whole run; a read-only run
// leaves no step; the properties block (frontmatter) rides the same step; the AI wash follows
// the undo; a user edit in the middle of a run is never swallowed into the run's step.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { undoDepth, redoDepth } from '@tiptap/pm/history'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { runOps, type MdOp } from '../src/renderer/editor/ops'
import {
  onRunHistoryChange,
  runHistoryOf,
  setRunFrontmatterSink,
} from '../src/renderer/editor/aiRunHistory'

const editors: Editor[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const e of editors.splice(0)) e.destroy()
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T10:00:00Z'))
})

function createEditor(md: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '',
  })
  // the loaded document is the baseline: nothing before it is undoable (as App.loadFromPath does)
  editor.chain().setMeta('addToHistory', false).setContent(md, { contentType: 'markdown' }).run()
  editors.push(editor)
  return editor
}

const text = (editor: Editor): string => editor.getMarkdown().trim()
const depth = (editor: Editor): number => undoDepth(editor.state)
/** a pause longer than the history's own grouping delay (500 ms): without run grouping each op is its own step */
const pause = (): void => {
  vi.setSystemTime(Date.now() + 5000)
}
const ai = (editor: Editor, ...ops: MdOp[]) => runOps(editor, ops, { source: 'ai' })

const START = 'one\n\ntwo\n\nthree\n\nfour'

describe('markdown AI run: one undo step', () => {
  it('folds the ops of a run, far apart in time and place, into one undo step', () => {
    const editor = createEditor(START)
    const before = text(editor)
    const group = runHistoryOf(editor)
    group.begin('run-1')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'ONE' })
    pause()
    ai(editor, { op: 'replaceText', target: { start: 2 }, find: 'three', replace: 'THREE' })
    pause()
    ai(editor, { op: 'insertContent', after: 3, markdown: 'five' })
    group.end('run-1', true)
    const after = text(editor)
    expect(after).not.toBe(before)
    expect(depth(editor)).toBe(1)

    editor.commands.undo()
    expect(text(editor)).toBe(before)
    expect(depth(editor)).toBe(0)

    editor.commands.redo()
    expect(text(editor)).toBe(after)
    expect(redoDepth(editor.state)).toBe(0)
  })

  it('a read-only run (or one that changed nothing) leaves no undo step', () => {
    const editor = createEditor(START)
    const group = runHistoryOf(editor)
    group.begin('run-ro')
    group.end('run-ro', false)
    // a stop mid-run reports mutated even when no tool got to edit
    group.begin('run-stop')
    group.end('run-stop', true)
    expect(depth(editor)).toBe(0)
    expect(editor.can().undo()).toBe(false)
  })

  it('a run is separate from the step before it and the step after it', () => {
    const editor = createEditor(START)
    const group = runHistoryOf(editor)
    const original = text(editor)
    // the user's own edit just before the run (adjacent and within the grouping delay)
    editor.commands.setTextSelection(4)
    editor.commands.insertContent('X')
    const afterUser = text(editor)
    group.begin('run-a')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'uno' })
    ai(editor, { op: 'replaceText', target: { start: 1 }, find: 'two', replace: 'dos' })
    group.end('run-a', true)
    const afterRun = text(editor)
    // typing right after the run, inside the grouping delay
    editor.commands.setTextSelection(4)
    editor.commands.insertContent('Y')
    expect(depth(editor)).toBe(3)

    editor.commands.undo()
    expect(text(editor)).toBe(afterRun)
    editor.commands.undo()
    expect(text(editor)).toBe(afterUser)
    editor.commands.undo()
    expect(text(editor)).toBe(original)
  })

  it('a run that stops half way is still one step back', () => {
    const editor = createEditor(START)
    const before = text(editor)
    const group = runHistoryOf(editor)
    group.begin('run-stop')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: '1' })
    pause()
    ai(editor, { op: 'replaceText', target: { start: 3 }, find: 'four', replace: '4' })
    group.end('run-stop', true)
    expect(depth(editor)).toBe(1)
    editor.commands.undo()
    expect(text(editor)).toBe(before)
  })

  it('a failed batch inside a run leaves nothing of itself in the step', () => {
    const editor = createEditor(START)
    const before = text(editor)
    const group = runHistoryOf(editor)
    group.begin('run-fail')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: '1' })
    const failed = ai(
      editor,
      { op: 'replaceText', target: { start: 1 }, find: 'two', replace: '2' },
      { op: 'replaceText', target: { start: 2 }, find: 'absent', replace: 'x' },
    )
    expect(failed.rolledBack).toBe(true)
    group.end('run-fail', true)
    expect(depth(editor)).toBe(1)
    editor.commands.undo()
    expect(text(editor)).toBe(before)
    editor.commands.redo()
    expect(text(editor)).toContain('1')
    expect(text(editor)).not.toContain('2')
  })

  it('a user edit in the middle of a run is not swallowed: the run splits around it', () => {
    const editor = createEditor(START)
    const before = text(editor)
    const group = runHistoryOf(editor)
    group.begin('run-mid')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'ONE' })
    // the user types in the last block while the run is going (within the grouping delay)
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent('!')
    ai(editor, { op: 'replaceText', target: { start: 1 }, find: 'two', replace: 'TWO' })
    group.end('run-mid', true)
    expect(depth(editor)).toBe(3)

    editor.commands.undo()
    expect(text(editor)).toContain('two')
    expect(text(editor)).toContain('!')
    editor.commands.undo()
    expect(text(editor)).not.toContain('!')
    expect(text(editor)).toContain('ONE')
    editor.commands.undo()
    expect(text(editor)).toBe(before)
  })

  it('a user edit as the LAST thing before the run ends leaves no empty marker step', () => {
    const editor = createEditor(START)
    const before = text(editor)
    const events: Array<[string, string]> = []
    onRunHistoryChange(editor, (e) => events.push([e.runId, e.direction]))
    const group = runHistoryOf(editor)
    group.begin('run-last')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'ONE' })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent('!')
    group.end('run-last', true)
    // the AI group and the user's keystroke: the end marker is no step of its own
    expect(depth(editor)).toBe(2)

    // the first Ctrl+Z takes back what the user typed, not an invisible marker
    editor.commands.undo()
    expect(text(editor)).not.toContain('!')
    expect(text(editor)).toContain('ONE')
    expect(events).toEqual([])
    // the second one undoes the run
    editor.commands.undo()
    expect(text(editor)).toBe(before)
    expect(events).toEqual([['run-last', 'undo']])
    editor.commands.redo()
    expect(text(editor)).toContain('ONE')
    expect(events).toEqual([
      ['run-last', 'undo'],
      ['run-last', 'redo'],
    ])
  })

  it('undoing a later piece of a split run is not the run being undone; the first piece is', () => {
    const editor = createEditor(START)
    const before = text(editor)
    const events: Array<[string, string]> = []
    onRunHistoryChange(editor, (e) => events.push([e.runId, e.direction]))
    const group = runHistoryOf(editor)
    group.begin('run-split')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'ONE' })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent('!')
    ai(editor, { op: 'replaceText', target: { start: 1 }, find: 'two', replace: 'TWO' })
    ai(editor, { op: 'replaceText', target: { start: 2 }, find: 'three', replace: 'THREE' })
    group.end('run-split', true)
    expect(depth(editor)).toBe(3)

    editor.commands.undo() // the later AI piece
    expect(text(editor)).toContain('two')
    expect(text(editor)).not.toContain('TWO')
    expect(events).toEqual([])
    editor.commands.undo() // the user's keystroke
    expect(events).toEqual([])
    editor.commands.undo() // the first AI piece: the run is gone
    expect(text(editor)).toBe(before)
    expect(events).toEqual([['run-split', 'undo']])
  })

  it('a run that starts with a properties change reports its undo from that first step', () => {
    const editor = createEditor(START)
    const events: Array<[string, string]> = []
    onRunHistoryChange(editor, (e) => events.push([e.runId, e.direction]))
    const group = runHistoryOf(editor)
    group.begin('run-fm-first')
    group.recordFrontmatter('', '---\ntags: a\n---\n')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'ONE' })
    group.end('run-fm-first', true)
    expect(depth(editor)).toBe(1)
    editor.commands.undo()
    expect(events).toEqual([['run-fm-first', 'undo']])
  })

  it('the AI wash follows the undo: nothing stays highlighted over reverted text', () => {
    const editor = createEditor(START)
    const group = runHistoryOf(editor)
    group.begin('run-wash')
    ai(editor, { op: 'setStyle', target: { start: 0 }, style: 'bold' })
    expect(editor.view.dom.querySelectorAll('.ai-changed').length).toBeGreaterThan(0)
    group.end('run-wash', true)
    editor.commands.undo()
    expect(text(editor)).not.toContain('**')
    expect(editor.view.dom.querySelectorAll('.ai-changed')).toHaveLength(0)
  })
})

describe('markdown AI run: the properties block rides the same step', () => {
  it('undo puts body and frontmatter back, redo re-applies both', () => {
    const editor = createEditor(START)
    const before = text(editor)
    const sink: string[] = []
    setRunFrontmatterSink(editor, (raw) => sink.push(raw))
    const group = runHistoryOf(editor)
    const OLD = '---\ntitle: Old\n---\n'
    const NEW = '---\ntitle: New\n---\n'
    group.begin('run-fm')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'ONE' })
    group.recordFrontmatter(OLD, NEW)
    group.end('run-fm', true)
    expect(depth(editor)).toBe(1)

    editor.commands.undo()
    expect(text(editor)).toBe(before)
    expect(sink.at(-1)).toBe(OLD)
    editor.commands.redo()
    expect(text(editor)).toContain('ONE')
    expect(sink.at(-1)).toBe(NEW)
  })

  it('a run that only changed the properties is one undoable step', () => {
    const editor = createEditor(START)
    const sink: string[] = []
    setRunFrontmatterSink(editor, (raw) => sink.push(raw))
    const group = runHistoryOf(editor)
    group.begin('run-fm-only')
    group.recordFrontmatter('', '---\ntags: a\n---\n')
    group.end('run-fm-only', true)
    expect(depth(editor)).toBe(1)
    editor.commands.undo()
    expect(sink.at(-1)).toBe('')
  })

  it('an unchanged properties block records nothing', () => {
    const editor = createEditor(START)
    const group = runHistoryOf(editor)
    group.begin('run-fm-same')
    group.recordFrontmatter('---\ntags: a\n---\n', '---\ntags: a\n---\n')
    group.end('run-fm-same', true)
    expect(depth(editor)).toBe(0)
  })
})

describe('markdown AI run: undo and redo reach the panel by run id', () => {
  it('reports the run that was undone and the run that was redone', () => {
    const editor = createEditor(START)
    const events: Array<[string, string]> = []
    onRunHistoryChange(editor, (e) => events.push([e.runId, e.direction]))
    const group = runHistoryOf(editor)
    group.begin('run-x')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'ONE' })
    group.end('run-x', true)
    expect(events).toEqual([])
    editor.commands.undo()
    editor.commands.redo()
    expect(events).toEqual([
      ['run-x', 'undo'],
      ['run-x', 'redo'],
    ])
  })

  it('a redo the panel refuses is not applied', () => {
    const editor = createEditor(START)
    const group = runHistoryOf(editor)
    group.begin('run-y')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'ONE' })
    group.end('run-y', true)
    const before = text(editor)
    editor.commands.undo()
    const undone = text(editor)
    group.refuseRedo((runId) => runId === 'run-y')
    editor.commands.redo()
    expect(text(editor)).toBe(undone)
    expect(text(editor)).not.toBe(before)
  })
})
