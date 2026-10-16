import type { zh } from './zh'

export const it = {
  collabMentionLabel: 'Menziona qualcuno',
  collabMentionSearching: 'Ricerca in corso…',
  collabMentionCount: 'Risultati: {count}',
  collabMentionNoMatch: 'Nessuna persona con accesso a questo documento corrisponde a “{query}”.',
  collabMentionNoCandidates: 'Nessun altro ha ancora accesso a questo documento.',
  collabMentionError: 'Impossibile caricare le persone.',
  collabMentionNoAccessBadge: 'Non può vedere',
} satisfies Record<keyof typeof zh, string>
