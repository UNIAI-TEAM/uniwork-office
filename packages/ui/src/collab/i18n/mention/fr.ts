import type { zh } from './zh'

export const fr = {
  collabMentionLabel: 'Mentionner quelqu’un',
  collabMentionSearching: 'Recherche en cours…',
  collabMentionCount: 'Résultats : {count}',
  collabMentionNoMatch: 'Aucune personne ayant accès à ce document ne correspond à « {query} ».',
  collabMentionNoCandidates: 'Personne d’autre n’a encore accès à ce document.',
  collabMentionError: 'Impossible de charger les personnes.',
  collabMentionNoAccessBadge: 'Sans accès',
} satisfies Record<keyof typeof zh, string>
