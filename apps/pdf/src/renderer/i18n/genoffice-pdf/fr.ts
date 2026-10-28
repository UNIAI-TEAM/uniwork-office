import type { zh } from './zh'

export const fr = {
  searchMatchCase: 'Respecter la casse',
  searchWholeWord: 'Mot entier',
  commentsPanel: 'Commentaires',
  commentsFilter: 'Filtrer les commentaires par texte ou auteur',
  commentsEmpty: 'Pas encore de commentaires dans ce document',
  commentsLoading: 'Chargement des commentaires',
} satisfies Record<keyof typeof zh, string>
