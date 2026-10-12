/**
 * G8-02 (UNI-1397): a comment written in the Docs editor carries the author the
 * host reports for the open document — the signed-in UniWork display name for a
 * bound file, else the neutral constant "User". The value is what the save
 * writes into word/comments.xml (w:author) and it is never the OS account name.
 */
import { Editor } from '@tiptap/core'
import { parseDocx, type CommentInfo } from '@genoffice/docx-engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { blocksToPmDoc } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { setModuleLang } from '../src/renderer/i18n/locale'
import {
  NEUTRAL_COMMENT_AUTHOR,
  commentAuthorName,
  refreshCommentAuthor,
  replyToComment,
  setCommentAuthor,
  submitNewComment,
  type ReviewContext,
} from '../src/renderer/review-actions'

const getCommentAuthor = vi.fn<(path: string | null) => Promise<string>>()
// the locale provider subscribes to the shell's language switch on mount
Object.assign(window, {
  desktop: { onLanguageChanged: () => () => undefined, getCommentAuthor },
})

setModuleLang('en')

async function makeEditor(): Promise<Editor> {
  const bytes = await buildDocx({ bodyXml: '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>' })
  const parsed = await parseDocx(bytes)
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: blocksToPmDoc(parsed.blocks) as never,
  })
  // a non-empty selection: the comment mark lands on the selected text
  editor.commands.setTextSelection({ from: 1, to: 6 })
  return editor
}

function makeCtx(editor: Editor | null): {
  ctx: ReviewContext
  state: { comments: CommentInfo[]; commentsDirty: boolean; dirty: boolean }
} {
  const state = { comments: [] as CommentInfo[], commentsDirty: false, dirty: false }
  const ctx = {
    editor,
    doc: null,
    dirtyRef: {
      get current() {
        return state.dirty
      },
      set current(v: boolean) {
        state.dirty = v
      },
    },
    // a live getter into the mirror: review actions read the previous write back
    get comments() {
      return state.comments
    },
    setStatus: () => undefined,
    setComments: (updater: unknown) => {
      state.comments = (updater as (prev: CommentInfo[]) => CommentInfo[])(state.comments)
    },
    setCommentsDirty: (v: boolean) => {
      state.commentsDirty = v
    },
    setCommentComposing: () => undefined,
  } as unknown as ReviewContext
  return { ctx, state }
}

afterEach(() => {
  getCommentAuthor.mockReset()
  setCommentAuthor(null)
})

describe('comment author source', () => {
  it('defaults to the neutral constant, never the OS account name', () => {
    expect(commentAuthorName()).toBe(NEUTRAL_COMMENT_AUTHOR)
    expect(NEUTRAL_COMMENT_AUTHOR).toBe('User')
  })

  it('a new comment carries the refreshed host author', async () => {
    getCommentAuthor.mockResolvedValue('Nguyễn An')
    await refreshCommentAuthor('/u/uniwork-documents/dep/acc/doc1/Plan.docx')
    expect(getCommentAuthor).toHaveBeenCalledWith('/u/uniwork-documents/dep/acc/doc1/Plan.docx')

    const editor = await makeEditor()
    const { ctx, state } = makeCtx(editor)
    submitNewComment(ctx, 'G8-02')
    expect(state.comments).toHaveLength(1)
    expect(state.comments[0]!.author).toBe('Nguyễn An')
    editor.destroy()
  })

  it('an unfit host answer (blank or failure) reads as the neutral constant', async () => {
    getCommentAuthor.mockResolvedValue('   ')
    await refreshCommentAuthor(null)
    expect(commentAuthorName()).toBe(NEUTRAL_COMMENT_AUTHOR)

    getCommentAuthor.mockRejectedValue(new Error('no host'))
    await refreshCommentAuthor(null)
    expect(commentAuthorName()).toBe(NEUTRAL_COMMENT_AUTHOR)
  })

  it('replies use the same source, including its neutral default', async () => {
    const editor = await makeEditor()
    const { ctx, state } = makeCtx(editor)
    // seed a thread to reply to: a comment mark over the selection
    setCommentAuthor('Nguyễn An')
    submitNewComment(ctx, 'root')
    const parent = state.comments[0]!.id

    editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(replyToComment(ctx, parent, 'reply')).toBe(true)
    expect(state.comments[1]!.author).toBe('Nguyễn An')

    setCommentAuthor(null)
    editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(replyToComment(ctx, parent, 'second reply')).toBe(true)
    expect(state.comments[2]!.author).toBe(NEUTRAL_COMMENT_AUTHOR)
    editor.destroy()
  })
})
