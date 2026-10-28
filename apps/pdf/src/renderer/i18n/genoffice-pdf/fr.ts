import type { zh } from './zh'

export const fr = {
  searchMatchCase: 'Respecter la casse',
  searchWholeWord: 'Mot entier',
  commentsPanel: 'Commentaires',
  commentsFilter: 'Filtrer les commentaires par texte ou auteur',
  commentsEmpty: 'Pas encore de commentaires dans ce document',
  commentsLoading: 'Chargement des commentaires',
  editLink: 'Lien',
  editLinkHint: 'Tracez un cadre sur la page pour ajouter un lien hypertexte',
  linkDialogTitle: 'Ajouter un lien',
  linkUrlLabel: 'Adresse web',
  linkPageLabel: 'Ou une page de ce document (1–{n})',
} satisfies Record<keyof typeof zh, string>
