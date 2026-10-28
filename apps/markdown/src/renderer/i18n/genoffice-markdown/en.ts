import type { zh } from './zh'

export const en = {
  backlinks: 'Backlinks',
  backlinksEmpty: 'No notes link here yet.',
  backlinksRefresh: 'Refresh backlinks',
  graph: 'Graph view',
  graphClose: 'Close the graph',
  graphEmpty: 'The vault has no notes yet.',
  graphTruncated: 'Too many notes: the graph shows the first {shown} of {total}.',
  suggestCreateNote: 'Create new note',
  tags: 'Tags',
  tagsEmpty: 'No #tags in the vault yet',
  blockLink: 'Copy link to block',
  blockLinkCopied: 'Copied {link}',
  blockLinkNone: 'Nothing here to link to',
  insertFootnote: 'Footnote',
  statusWords: '{n} words',
  statusChars: '{n} characters',
  highlight: 'Highlight',
} satisfies Record<keyof typeof zh, string>
