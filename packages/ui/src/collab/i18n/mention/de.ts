import type { zh } from './zh'

export const de = {
  collabMentionLabel: 'Jemanden erwähnen',
  collabMentionSearching: 'Suche läuft…',
  collabMentionCount: 'Ergebnisse: {count}',
  collabMentionNoMatch: 'Niemand mit Zugriff auf dieses Dokument passt zu „{query}“.',
  collabMentionNoCandidates: 'Noch niemand sonst hat Zugriff auf dieses Dokument.',
  collabMentionError: 'Personen konnten nicht geladen werden.',
  collabMentionNoAccessBadge: 'Kein Zugriff',
} satisfies Record<keyof typeof zh, string>
