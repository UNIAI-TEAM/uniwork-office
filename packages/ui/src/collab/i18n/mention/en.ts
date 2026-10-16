import type { zh } from './zh'

export const en = {
  collabMentionLabel: 'Mention someone',
  collabMentionSearching: 'Searching…',
  collabMentionCount: 'Results: {count}',
  collabMentionNoMatch: 'No one with access to this document matches “{query}”.',
  collabMentionNoCandidates: 'No one else has access to this document yet.',
  collabMentionError: 'Couldn’t load people.',
  collabMentionNoAccessBadge: "Can't view",
} satisfies Record<keyof typeof zh, string>
