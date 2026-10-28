import type { zh } from './zh'

export const ru = {
  searchMatchCase: 'Учитывать регистр',
  searchWholeWord: 'Слово целиком',
  commentsPanel: 'Commenti',
  commentsFilter: 'Filtra i commenti per testo o autore',
  commentsEmpty: 'Ancora nessun commento in questo documento',
  commentsLoading: 'Caricamento dei commenti',
  editLink: 'Link',
  editLinkHint: 'Trascina un riquadro sulla pagina per aggiungere un collegamento',
  linkDialogTitle: 'Aggiungi link',
  linkUrlLabel: 'Indirizzo web',
  linkPageLabel: 'Oppure una pagina di questo documento (1–{n})',
} satisfies Record<keyof typeof zh, string>
