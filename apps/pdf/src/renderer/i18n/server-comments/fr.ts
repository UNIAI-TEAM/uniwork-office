import type { zh } from './zh'

export const fr = {
  serverCommentStartUnavailable:
    'Impossible d’ajouter un nouveau commentaire à ce document pour le moment.',
  serverCommentSaveFirst: 'Enregistrez d’abord le document pour ajouter un commentaire',
} satisfies Record<keyof typeof zh, string>
