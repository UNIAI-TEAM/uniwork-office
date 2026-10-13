import type { zh } from './zh'

export const pl = {
  collabMentionLabel: 'Wspomnij kogoś',
  collabMentionSearching: 'Wyszukiwanie…',
  collabMentionCount: 'Wyniki: {count}',
  collabMentionNoMatch: 'Nikt z dostępem do tego dokumentu nie pasuje do „{query}”.',
  collabMentionNoCandidates: 'Nikt inny nie ma jeszcze dostępu do tego dokumentu.',
  collabMentionError: 'Nie udało się wczytać listy osób.',
} satisfies Record<keyof typeof zh, string>
