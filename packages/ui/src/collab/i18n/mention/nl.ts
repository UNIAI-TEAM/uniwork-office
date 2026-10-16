import type { zh } from './zh'

export const nl = {
  collabMentionLabel: 'Iemand vermelden',
  collabMentionSearching: 'Zoeken…',
  collabMentionCount: 'Resultaten: {count}',
  collabMentionNoMatch: 'Niemand met toegang tot dit document komt overeen met “{query}”.',
  collabMentionNoCandidates: 'Niemand anders heeft nog toegang tot dit document.',
  collabMentionError: 'Kan de personen niet laden.',
  collabMentionNoAccessBadge: 'Kan niet bekijken',
} satisfies Record<keyof typeof zh, string>
