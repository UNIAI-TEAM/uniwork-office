import type { zh } from './zh'

export const en = {
  searchMatchCase: 'Match case',
  searchWholeWord: 'Whole words',
  commentsPanel: 'Comments',
  commentsFilter: 'Filter comments by text or author',
  commentsEmpty: 'No comments in this document yet',
  commentsLoading: 'Loading comments',
} satisfies Record<keyof typeof zh, string>
