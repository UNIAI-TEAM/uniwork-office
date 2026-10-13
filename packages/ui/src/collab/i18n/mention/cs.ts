import type { zh } from './zh'

export const cs = {
  collabMentionLabel: 'Zmínit někoho',
  collabMentionSearching: 'Hledání…',
  collabMentionCount: 'Výsledky: {count}',
  collabMentionNoMatch: 'K „{query}“ neodpovídá nikdo, kdo má k tomuto dokumentu přístup.',
  collabMentionNoCandidates: 'K tomuto dokumentu zatím nemá přístup nikdo další.',
  collabMentionError: 'Seznam osob se nepodařilo načíst.',
} satisfies Record<keyof typeof zh, string>
