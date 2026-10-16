/**
 * G8-12 (UNI-1407): when the Docs editor is in server-comment mode, and what that changes in the
 * local review actions. A local file (no `window.uniworkComments`, or `context` not ok) keeps
 * today's behaviour exactly; in server mode the Comment command opens the server composer and the
 * comments stored in the file are read-only (lane decision D4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { CommentInfo } from '@genoffice/docx-engine'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { addCommentToRange } from '../src/renderer/editor/comments'
import { readContext, resolveServerMode } from '../src/renderer/server-comments/mode'
import type { ServerCommentsApi } from '../src/renderer/server-comments/seam'
import {
  addCommentAt,
  deleteAllComments,
  deleteComment,
  editComment,
  replyToComment,
  resolveComment,
  startNewComment,
  submitNewComment,
  type ReviewContext,
} from '../src/renderer/review-actions'

const apiWith = (context: unknown) =>
  ({ context: vi.fn(() => Promise.resolve(context)) }) as unknown as ServerCommentsApi

describe('resolveServerMode', () => {
  it('a local file stays local: no API, no context method, an error envelope, a malformed answer', async () => {
    expect(await resolveServerMode(undefined, '/a.docx')).toBeNull()
    expect(await resolveServerMode({} as ServerCommentsApi, '/a.docx')).toBeNull()
    expect(
      await resolveServerMode(apiWith({ ok: false, error: { code: 'not_found' } }), '/a.docx'),
    ).toBeNull()
    expect(await resolveServerMode(apiWith({ ok: true, value: { nope: 1 } }), '/a.docx')).toBeNull()
    const throwing = {
      context: () => Promise.reject(new Error('x')),
    } as unknown as ServerCommentsApi
    expect(await resolveServerMode(throwing, '/a.docx')).toBeNull()
  })

  it('tells the frame there is no editor owner to wait for when the document is not in server mode', async () => {
    const withHook = (context: unknown) => {
      const noEditor = vi.fn()
      return {
        api: {
          context: vi.fn(() => Promise.resolve(context)),
          noEditor,
        } as unknown as ServerCommentsApi,
        noEditor,
      }
    }
    const miss = withHook({ ok: false, error: { code: 'not_found' } })
    expect(await resolveServerMode(miss.api, '')).toBeNull()
    expect(miss.noEditor).toHaveBeenCalledTimes(1)
    const hit = withHook({ ok: true, value: { documentId: 'd1', versionId: 'v1' } })
    expect(await resolveServerMode(hit.api, '')).not.toBeNull()
    expect(hit.noEditor).not.toHaveBeenCalled()
    const throwing = {
      context: () => Promise.reject(new Error('x')),
      noEditor: vi.fn(),
    } as unknown as ServerCommentsApi
    expect(await resolveServerMode(throwing, '')).toBeNull()
    expect(throwing.noEditor).toHaveBeenCalledTimes(1)
  })

  it('a bound document answers its context; an unknown level is dropped, a null version kept', async () => {
    const api = apiWith({
      ok: true,
      value: { documentId: 'd1', versionId: null, level: 'owner', myUserId: 'u1' },
    })
    expect(await resolveServerMode(api, '/a.docx')).toEqual({
      api,
      path: '/a.docx',
      documentId: 'd1',
      versionId: null,
      myUserId: 'u1',
    })
    expect(api.context).toHaveBeenCalledWith({ path: '/a.docx' })
    // the web frame has no path; the port ignores it
    expect((await resolveServerMode(api, null))?.path).toBe('')
    expect(readContext({ documentId: 'd1', versionId: 'v1', level: 'view' })).toEqual({
      documentId: 'd1',
      versionId: 'v1',
      level: 'view',
    })
    // DOC5-W04: the comment level passes through; an unknown word is still dropped, never raised
    expect(readContext({ documentId: 'd1', versionId: 'v1', level: 'comment' })?.level).toBe(
      'comment',
    )
    expect(readContext({ documentId: 'd1', versionId: 'v1', level: 'owner' })).not.toHaveProperty(
      'level',
    )
    // the web frame marks its context; anything but `true` is ignored
    expect(readContext({ documentId: 'd1', versionId: null, frame: true })?.frame).toBe(true)
    expect(readContext({ documentId: 'd1', versionId: null, frame: 'yes' })).not.toHaveProperty(
      'frame',
    )
  })
})

const editors = new Set<Editor>()
afterEach(() => {
  for (const e of editors) e.destroy()
  editors.clear()
})

function ctxFor(server: ReviewContext['server']) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [{ type: 'text', text: 'Some words here' }],
        },
      ],
    },
  })
  editors.add(editor)
  addCommentToRange(editor, 1, 5, '1')
  const comments: CommentInfo[] = [
    { id: '1', author: 'User', date: '2026-01-01T00:00:00Z', text: 'in file' },
  ]
  const ctx = {
    editor,
    doc: null,
    dirtyRef: { current: false },
    setStatus: vi.fn(),
    comments,
    setComments: vi.fn(),
    setCommentsDirty: vi.fn(),
    setCommentComposing: vi.fn(),
    setShowComments: vi.fn(),
    setCommentFocus: vi.fn(),
    server,
  } as unknown as ReviewContext
  return { ctx, editor }
}

describe('review actions in server mode', () => {
  it('New Comment opens the server composer instead of the local one', () => {
    const startThread = vi.fn()
    const { ctx, editor } = ctxFor({ startThread })
    editor.commands.setTextSelection({ from: 6, to: 11 })
    startNewComment(ctx)
    expect(startThread).toHaveBeenCalledTimes(1)
    expect(ctx.setCommentComposing).not.toHaveBeenCalled()
  })

  it('comments stored in the file are read-only: no local write, the file stays clean', () => {
    const { ctx, editor } = ctxFor({ startThread: vi.fn() })
    const before = JSON.stringify(editor.getJSON())
    submitNewComment(ctx, 'x')
    expect(addCommentAt(ctx, { from: 6, to: 11 }, 'x', 'AI')).toBeNull()
    expect(replyToComment(ctx, '1', 'x')).toBe(false)
    editComment(ctx, '1', 'x')
    resolveComment(ctx, '1', true)
    deleteComment(ctx, '1')
    deleteAllComments(ctx, false)
    expect(ctx.setComments).not.toHaveBeenCalled()
    expect(ctx.setCommentsDirty).not.toHaveBeenCalled()
    expect(ctx.dirtyRef.current).toBe(false)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
  })

  it('a local file keeps the old behaviour (regression)', () => {
    const { ctx, editor } = ctxFor(null)
    editor.commands.setTextSelection({ from: 6, to: 11 })
    startNewComment(ctx)
    expect(ctx.setCommentComposing).toHaveBeenCalledWith(true)
    expect(ctx.setShowComments).toHaveBeenCalledWith(true)
    resolveComment(ctx, '1', true)
    expect(ctx.setCommentsDirty).toHaveBeenCalledWith(true)
  })
})
