import type { zh } from './zh'

export const es = {
  collabMentionLabel: 'Mencionar a alguien',
  collabMentionSearching: 'Buscando…',
  collabMentionCount: 'Resultados: {count}',
  collabMentionNoMatch: 'Nadie con acceso a este documento coincide con «{query}».',
  collabMentionNoCandidates: 'Todavía nadie más tiene acceso a este documento.',
  collabMentionError: 'No se pudo cargar la lista de personas.',
} satisfies Record<keyof typeof zh, string>
