import type { zh } from './zh'

export const en = {
  serverCommentStartUnavailable: 'A new comment can’t be added to this document right now.',
  serverCommentSaveFirst: 'Save the document first to add a comment',
} satisfies Record<keyof typeof zh, string>
