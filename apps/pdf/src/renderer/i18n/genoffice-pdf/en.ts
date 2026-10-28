import type { zh } from './zh'

export const en = {
  searchMatchCase: 'Match case',
  searchWholeWord: 'Whole words',
  commentsPanel: 'Comments',
  commentsFilter: 'Filter comments by text or author',
  commentsEmpty: 'No comments in this document yet',
  commentsLoading: 'Loading comments',
  editLink: 'Link',
  editLinkHint: 'Drag a box on the page to add a hyperlink',
  linkDialogTitle: 'Add Link',
  linkUrlLabel: 'Web address',
  linkPageLabel: 'Or a page in this document (1–{n})',
} satisfies Record<keyof typeof zh, string>
