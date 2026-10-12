import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { blockRange } from '../src/renderer/editor/ops'
import { executeTool, type FrontmatterAccess } from '../src/renderer/ai/tools'
import {
  clearEditFence,
  fencedBlocks,
  hasEditFence,
  selectionFence,
  setEditFence,
  turnFence,
} from '../src/renderer/ai/edit-fence'

// G6-12 #9: in a turn that edits the selection (scope chip) or the queued targets, the code
// refuses edits outside them; the text outside stays byte-identical whatever the model sends.

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

function createEditor(md: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '',
  })
  editor.commands.setContent(md, { contentType: 'markdown' })
  editors.push(editor)
  return editor
}

/** a fence over top-level blocks start..end (inclusive), as the panel builds it at send */
function fenceBlocks(editor: Editor, start: number, end = start) {
  return blockRange(editor.state.doc, start, end)
}

function selectText(editor: Editor, needle: string): void {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    if (from >= 0) return false
    if (node.isText && node.text?.includes(needle)) from = pos + node.text.indexOf(needle)
    return from < 0
  })
  expect(from).toBeGreaterThan(0)
  const doc = editor.state.doc
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(doc, from, from + needle.length)),
  )
}

const ops = (...list: Record<string, unknown>[]) => ({
  id: 't1',
  name: 'apply_ops',
  input: { ops: list },
})

async function run(
  editor: Editor,
  call: { id: string; name: string; input: Record<string, unknown> },
  fm?: FrontmatterAccess,
) {
  return await executeTool(editor, call, undefined, fm)
}

const DOC = '# Title\n\nalpha one\n\nbeta two\n\ngamma three'

describe('markdown selection edit fence', () => {
  it('selectionFence covers the selected text', () => {
    const editor = createEditor(DOC)
    selectText(editor, 'two')
    const fence = selectionFence(editor)
    expect(fence).toHaveLength(1)
    expect(editor.state.doc.textBetween(fence![0]!.from, fence![0]!.to)).toBe('two')
    editor.commands.setTextSelection(1)
    expect(selectionFence(editor)).toBeNull()
  })

  it('an edit inside the fenced blocks applies', async () => {
    const editor = createEditor(DOC)
    setEditFence(editor, [fenceBlocks(editor, 2)])
    const r = await run(
      editor,
      ops({ op: 'replaceText', target: { start: 2 }, find: 'two', replace: '2' }),
    )
    expect(r.isError).toBeUndefined()
    expect(editor.getMarkdown()).toContain('beta 2')
  })

  it('an edit outside the fence is refused and the document stays identical', async () => {
    const editor = createEditor(DOC)
    const before = editor.getMarkdown()
    setEditFence(editor, [fenceBlocks(editor, 2)])
    const r = await run(
      editor,
      ops({ op: 'replaceText', target: { start: 1 }, find: 'one', replace: '1' }),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/outside the (selection|targets)/i)
    expect(editor.getMarkdown()).toBe(before)
  })

  it('a batch mixing an inside and an outside edit applies nothing', async () => {
    const editor = createEditor(DOC)
    const before = editor.getMarkdown()
    setEditFence(editor, [fenceBlocks(editor, 2)])
    const r = await run(
      editor,
      ops(
        { op: 'replaceText', target: { start: 2 }, find: 'two', replace: '2' },
        { op: 'deleteBlocks', target: { start: 3 } },
      ),
    )
    expect(r.isError).toBe(true)
    expect(editor.getMarkdown()).toBe(before)
  })

  it('"whole document" writers are refused while fenced', async () => {
    const editor = createEditor(DOC)
    const before = editor.getMarkdown()
    setEditFence(editor, [fenceBlocks(editor, 2)])
    const replaceAll = await run(
      editor,
      ops({ op: 'replaceBlocks', target: { start: 0, end: 3 }, markdown: 'all new' }),
    )
    expect(replaceAll.isError).toBe(true)
    const writer = {
      write: async () => ({ ok: true, markdown: 'rewritten' }),
    }
    const rewrite = await executeTool(
      editor,
      { id: 't2', name: 'write_document', input: { plan: 'rewrite', replaceDocument: true } },
      undefined,
      undefined,
      writer as never,
    )
    expect(rewrite.isError).toBe(true)
    expect(editor.getMarkdown()).toBe(before)
  })

  it('the frontmatter is outside every fence', async () => {
    const editor = createEditor(DOC)
    let yaml = 'title: Old'
    const fm: FrontmatterAccess = { read: () => yaml, write: (v) => (yaml = v) }
    setEditFence(editor, [fenceBlocks(editor, 2)])
    const r = await run(editor, ops({ op: 'setFrontmatter', yaml: 'title: New' }), fm)
    expect(r.isError).toBe(true)
    expect(yaml).toBe('title: Old')
  })

  it('queued targets: edits in each target apply, the gap between them is refused', async () => {
    const editor = createEditor(DOC)
    setEditFence(editor, [fenceBlocks(editor, 1), fenceBlocks(editor, 3)])
    const ok = await run(
      editor,
      ops(
        { op: 'replaceText', target: { start: 1 }, find: 'one', replace: '1' },
        { op: 'replaceText', target: { start: 3 }, find: 'three', replace: '3' },
      ),
    )
    expect(ok.isError).toBeUndefined()
    const before = editor.getMarkdown()
    const gap = await run(
      editor,
      ops({ op: 'replaceText', target: { start: 2 }, find: 'two', replace: '2' }),
    )
    expect(gap.isError).toBe(true)
    expect(editor.getMarkdown()).toBe(before)
  })

  it('the fence follows earlier edits and clears at the end of the turn', async () => {
    const editor = createEditor(DOC)
    setEditFence(editor, [fenceBlocks(editor, 3)])
    // a block inserted inside the target keeps the fence over the target's new position
    const grow = await run(editor, ops({ op: 'insertContent', after: 3, markdown: 'delta four' }))
    expect(grow.isError).toBeUndefined()
    // the user types above the target: positions shift, the fence moves with them
    editor.commands.insertContentAt(1, 'X')
    await run(editor, { id: 't3', name: 'get_document_context', input: {} })
    const inside = await run(
      editor,
      ops({ op: 'replaceText', target: { start: 3 }, find: 'three', replace: '3' }),
    )
    expect(inside.isError).toBeUndefined()
    expect(editor.getMarkdown()).toContain('gamma 3')
    setEditFence(editor, null)
    const free = await run(
      editor,
      ops({ op: 'replaceText', target: { start: 1 }, find: 'one', replace: '1' }),
    )
    expect(free.isError).toBeUndefined()
  })

  it('no fence: outside edits keep working as before', async () => {
    const editor = createEditor(DOC)
    const r = await run(
      editor,
      ops({ op: 'replaceText', target: { start: 1 }, find: 'one', replace: '1' }),
    )
    expect(r.isError).toBeUndefined()
  })
})

// round 2: a retried turn runs with its own scope, and the fence ends with the run

describe('markdown fence on retry and at run end', () => {
  it('an unscoped turn gets no fence even while a selection is live (retry of an older whole-document entry)', () => {
    const editor = createEditor(DOC)
    selectText(editor, 'two')
    expect(turnFence(editor, { scoped: false })).toBeNull()
  })

  it('a scoped turn is fenced to the live selection', () => {
    const editor = createEditor(DOC)
    selectText(editor, 'two')
    const fence = turnFence(editor, { scoped: true })
    expect(fence).toHaveLength(1)
    expect(editor.state.doc.textBetween(fence![0]!.from, fence![0]!.to)).toBe('two')
  })

  it('a scoped retry whose selection is gone keeps the fence of the turn it repeats', () => {
    const editor = createEditor(DOC)
    const kept = [fenceBlocks(editor, 3)]
    expect(turnFence(editor, { scoped: true, fallback: kept })).toEqual(kept)
    // a scoped entry never silently becomes a whole-document turn when it can be fenced
    selectText(editor, 'one')
    const live = turnFence(editor, { scoped: true, fallback: kept })
    expect(editor.state.doc.textBetween(live![0]!.from, live![0]!.to)).toBe('one')
  })

  it('a queue submission keeps its anchored ranges, scope or not', () => {
    const editor = createEditor(DOC)
    selectText(editor, 'two')
    const queued = [fenceBlocks(editor, 1)]
    expect(turnFence(editor, { scoped: false, queueFence: queued })).toEqual(queued)
  })

  it('clearEditFence ends the fence: no refusal afterwards, no transaction listener left', async () => {
    const editor = createEditor(DOC)
    const listeners = () =>
      (editor as unknown as { callbacks: Record<string, unknown[] | undefined> }).callbacks
        .transaction?.length ?? 0
    const baseline = listeners()
    setEditFence(editor, [fenceBlocks(editor, 2)])
    expect(hasEditFence(editor)).toBe(true)
    expect(listeners()).toBe(baseline + 1)
    const ranges = clearEditFence(editor)
    expect(ranges).toHaveLength(1)
    expect(hasEditFence(editor)).toBe(false)
    expect(fencedBlocks(editor)).toEqual([])
    expect(listeners()).toBe(baseline)
    const free = await run(
      editor,
      ops({ op: 'replaceText', target: { start: 1 }, find: 'one', replace: '1' }),
    )
    expect(free.isError).toBeUndefined()
  })

  it('clearEditFence on an editor without a fence is a no-op', () => {
    const editor = createEditor(DOC)
    expect(clearEditFence(editor)).toBeNull()
  })
})
