/**
 * The collab DTO copies (`src/collab/types.ts`) must stay assignable from the protocol types
 * (`web/docs/protocol/types.ts`): the only place the collab module may look at the protocol.
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  COMMENTS_REVEAL_WAIT_MS as PROTOCOL_REVEAL_WAIT_MS,
  type CommentMention,
  type CommentRevision,
  type CommentsLevel,
  type CommentKind,
  type CommentAnchorState,
  type CommentAnchor,
  type CommentsListResult,
  type DocumentComment,
  type MentionCandidate,
  type CommentsCreatePayload,
  type CommentsDeleteResult,
} from '../../../web/docs/protocol/types'
import {
  toCollabError,
  type CollabAnchor,
  type CollabAnchorState,
  type CollabCandidate,
  type CollabComment,
  type CollabKind,
  type CollabLevel,
  type CollabListResult,
  type CollabMention,
  type CollabRevision,
  type CollabSource,
} from '../src/collab/types'
import { COMMENTS_REVEAL_WAIT_MS } from '../src/collab/use-collab-threads'

// compile-time: a protocol value is accepted wherever the collab copy is expected
const comment: CollabComment = {} as DocumentComment
const listResult: CollabListResult = {} as CommentsListResult
const mention: CollabMention = {} as CommentMention
const revision: CollabRevision = {} as CommentRevision
const candidate: CollabCandidate = {} as MentionCandidate
const anchor: CollabAnchor = {} as CommentAnchor
const level: CollabLevel = 'view' as CommentsLevel
const kind: CollabKind = 'comment' as CommentKind
const state: CollabAnchorState = 'exact' as CommentAnchorState
// the collab create payload is a protocol create payload
const create: CommentsCreatePayload = {} as Parameters<CollabSource['create']>[0]
const outcome: CollabSource['remove'] extends (p: never) => Promise<infer R> ? R : never =
  {} as CommentsDeleteResult

describe('collab protocol shape', () => {
  it('protocol DTOs are assignable to the collab copies', () => {
    expectTypeOf<DocumentComment>().toMatchTypeOf<CollabComment>()
    expectTypeOf<CommentsListResult>().toMatchTypeOf<CollabListResult>()
    expectTypeOf<CommentMention>().toMatchTypeOf<CollabMention>()
    expectTypeOf<CommentRevision>().toMatchTypeOf<CollabRevision>()
    expectTypeOf<MentionCandidate>().toMatchTypeOf<CollabCandidate>()
    expect([
      comment,
      listResult,
      mention,
      revision,
      candidate,
      anchor,
      create,
      outcome,
    ]).toHaveLength(8)
    expect([level, kind, state]).toEqual(['view', 'comment', 'exact'])
  })

  it('the reveal wait matches the protocol', () => {
    expect(COMMENTS_REVEAL_WAIT_MS).toBe(PROTOCOL_REVEAL_WAIT_MS)
  })

  it('toCollabError reads a protocol error (code, details.code, retryable)', () => {
    expect(
      toCollabError({
        code: 'conflict',
        message: 'x',
        details: { code: 'comment_deleted' },
        retryable: false,
      }),
    ).toEqual({ code: 'conflict', detailsCode: 'comment_deleted', retryable: false })
    expect(toCollabError(new Error('boom'))).toEqual({ code: 'internal' })
  })
})
