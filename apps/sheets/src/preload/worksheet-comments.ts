/**
 * The preload's check of one worksheet comment from the sidecar (`workbookFileSchema` comments).
 * G8-13 (UNI-1408, finding F2): the threaded-comment identity (`thread`: root id, person, time,
 * resolved flag, replies) must reach the renderer, or a reopened workbook shows its threads as
 * legacy notes. Kept apart from index.ts (which needs Electron) so a test can drive it.
 */
import type { WorkbookFile } from '../shared/desktop-api'

type WorksheetComment = WorkbookFile['sheets'][number]['comments'][number]
type CommentThread = NonNullable<WorksheetComment['thread']>

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isNonnegativeInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isInteger(input) && input >= 0
}

function isText(input: unknown, max: number): input is string {
  return typeof input === 'string' && input.length <= max
}

function parseReply(input: unknown): CommentThread['replies'][number] {
  if (
    !isRecord(input) ||
    !isText(input.id, 64) ||
    !isText(input.personId, 64) ||
    !isText(input.author, 255) ||
    !isText(input.dT, 40) ||
    !isText(input.text, 32_767)
  ) {
    throw new Error('Invalid threaded comment reply.')
  }
  return {
    id: input.id,
    personId: input.personId,
    author: input.author,
    dT: input.dT,
    text: input.text,
  }
}

function parseThread(input: unknown): CommentThread {
  if (
    !isRecord(input) ||
    !isText(input.id, 64) ||
    !isText(input.personId, 64) ||
    !isText(input.author, 255) ||
    !isText(input.dT, 40) ||
    typeof input.done !== 'boolean' ||
    typeof input.text !== 'string' ||
    !Array.isArray(input.replies) ||
    input.replies.length > 500
  ) {
    throw new Error('Invalid threaded comment.')
  }
  return {
    id: input.id,
    personId: input.personId,
    author: input.author,
    dT: input.dT,
    done: input.done,
    text: input.text,
    replies: input.replies.map(parseReply),
  }
}

export function parseWorksheetComment(comment: unknown): WorksheetComment {
  if (
    !isRecord(comment) ||
    !isNonnegativeInteger(comment.row) ||
    !isNonnegativeInteger(comment.column) ||
    typeof comment.author !== 'string' ||
    typeof comment.text !== 'string'
  ) {
    throw new Error('Invalid worksheet comment.')
  }
  return {
    row: comment.row,
    column: comment.column,
    author: comment.author,
    text: comment.text,
    ...(comment.thread === undefined || comment.thread === null
      ? {}
      : { thread: parseThread(comment.thread) }),
  }
}
