import type { zh } from './zh'

export const cs = {
  searchMatchCase: 'Rozlišovat velikost písmen',
  searchWholeWord: 'Celá slova',
  commentsPanel: 'Komentáře',
  commentsFilter: 'Filtrovat komentáře podle textu nebo autora',
  commentsEmpty: 'V tomto dokumentu zatím nejsou žádné komentáře',
  commentsLoading: 'Načítání komentářů',
} satisfies Record<keyof typeof zh, string>
