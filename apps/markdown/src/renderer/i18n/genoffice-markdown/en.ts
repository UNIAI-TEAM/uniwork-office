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
} satisfies Record<keyof typeof zh, string>
