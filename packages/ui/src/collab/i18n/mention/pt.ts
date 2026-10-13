import type { zh } from './zh'

export const pt = {
  collabMentionLabel: 'Mencionar alguém',
  collabMentionSearching: 'Procurando…',
  collabMentionCount: 'Resultados: {count}',
  collabMentionNoMatch: 'Ninguém com acesso a este documento corresponde a “{query}”.',
  collabMentionNoCandidates: 'Ainda não há mais ninguém com acesso a este documento.',
  collabMentionError: 'Não foi possível carregar as pessoas.',
} satisfies Record<keyof typeof zh, string>
