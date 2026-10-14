/**
 * G8-12 (UNI-1407), invariant 7 / lane decision D5: on a document bound to UniWork the AI comment
 * tools never write comments. add_comment / reply_comment put a draft into the server composer and
 * say so; resolve_comment / delete_comment on a server thread are refused; comments stored in the
 * file are read-only (D4). A local file keeps the existing tool behaviour (ai-comment-tools.test.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { CommentInfo } from '@genoffice/docx-engine'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { executeTool, type AiCommentsAccess } from '../src/renderer/ai/tools'

const DATE = '2026-01-01T00:00:00Z'
const NUM_IDS = { bullet: null, ordered: null }
const para = (t: string) => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content: [{ type: 'text', text: t }],
})

const editors = new Set<Editor>()
afterEach(() => {
  for (const e of editors) e.destroy()
  editors.clear()
})

function setup() {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content: [para('Intro.'), para('Revenue grew in Q3.')] },
  })
  editors.add(editor)
  const inFile: CommentInfo[] = [{ id: '1', author: 'User', date: DATE, text: 'from the file' }]
  const server: CommentInfo[] = [
    { id: 'c9', author: 'An', date: DATE, text: 'server thread' },
    { id: 'c10', author: 'Bo', date: DATE, text: 'server reply', parentId: 'c9' },
  ]
  const drafts = {
    owns: (id: string) => server.some((c) => c.id === id),
    draftReply: vi.fn(() => true),
    draftNew: vi.fn(() => true),
  }
  const local = {
    reply: vi.fn(() => true),
    resolve: vi.fn(() => true),
    add: vi.fn(),
    remove: vi.fn(),
  }
  const access: AiCommentsAccess = {
    list: () => [...inFile, ...server],
    reply: local.reply,
    resolve: local.resolve,
    add: local.add,
    remove: local.remove,
    server: drafts,
  }
  const run = (name: string, input: Record<string, unknown>) =>
    executeTool(editor, { id: 't', name, input }, NUM_IDS, undefined, undefined, undefined, access)
  return { editor, drafts, local, run }
}

describe('AI comment tools on a bound document', () => {
  it('add_comment drafts a root with the resolved range; nothing is written', async () => {
    const { drafts, local, run } = setup()
    const out = await run('add_comment', { blockIndex: 1, text: 'Q3', comment: 'Which Q3?' })
    expect(out.isError).toBeFalsy()
    expect(out.mutated).toBe(false)
    expect(out.output).toMatch(/draft/i)
    expect(drafts.draftNew).toHaveBeenCalledTimes(1)
    const [range, text] = drafts.draftNew.mock.calls[0]! as unknown as [
      { from: number; to: number },
      string,
    ]
    expect(text).toBe('Which Q3?')
    expect(range.to - range.from).toBe(2)
    expect(local.add).not.toHaveBeenCalled()
  })

  it('reply_comment on a server reply drafts under the thread root', async () => {
    const { drafts, local, run } = setup()
    const out = await run('reply_comment', { parentId: 'c10', text: 'Done.' })
    expect(out.isError).toBeFalsy()
    expect(out.mutated).toBe(false)
    expect(out.output).toMatch(/draft/i)
    expect(drafts.draftReply).toHaveBeenCalledWith('c9', 'Done.')
    expect(local.reply).not.toHaveBeenCalled()
  })

  it('resolve_comment and delete_comment on a server thread are refused', async () => {
    const { local, run } = setup()
    const resolved = await run('resolve_comment', { id: 'c9' })
    expect(resolved.isError).toBe(true)
    expect(resolved.mutated).toBeFalsy()
    const deleted = await run('delete_comment', { id: 'c9', withReplies: true })
    expect(deleted.isError).toBe(true)
    expect(local.resolve).not.toHaveBeenCalled()
    expect(local.remove).not.toHaveBeenCalled()
  })

  it('comments stored in the file are read-only', async () => {
    const { drafts, local, run } = setup()
    for (const [name, input] of [
      ['reply_comment', { parentId: '1', text: 'x' }],
      ['resolve_comment', { id: '1' }],
      ['delete_comment', { id: '1' }],
    ] as const) {
      const out = await run(name, input)
      expect(out.isError).toBe(true)
    }
    expect(local.reply).not.toHaveBeenCalled()
    expect(local.resolve).not.toHaveBeenCalled()
    expect(local.remove).not.toHaveBeenCalled()
    expect(drafts.draftReply).not.toHaveBeenCalled()
  })

  it('read_comments lists the server threads next to the in-file ones', async () => {
    const { run } = setup()
    const out = await run('read_comments', {})
    expect(out.output).toContain('server thread')
    expect(out.output).toContain('reply id c10 by Bo: server reply')
    expect(out.output).toContain('from the file')
  })
})
