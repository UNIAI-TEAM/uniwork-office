import type { zh } from './zh'

export const ru = {
  searchMatchCase: 'Учитывать регистр',
  searchWholeWord: 'Слово целиком',
  commentsPanel: 'Commenti',
  commentsFilter: 'Filtra i commenti per testo o autore',
  commentsEmpty: 'Ancora nessun commento in questo documento',
  commentsLoading: 'Caricamento dei commenti',
} satisfies Record<keyof typeof zh, string>
