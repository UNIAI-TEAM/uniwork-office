import type { zh } from './zh'

export const cs = {
  searchMatchCase: 'Rozlišovat velikost písmen',
  searchWholeWord: 'Celá slova',
  commentsPanel: 'Komentáře',
  commentsFilter: 'Filtrovat komentáře podle textu nebo autora',
  commentsEmpty: 'V tomto dokumentu zatím nejsou žádné komentáře',
  commentsLoading: 'Načítání komentářů',
  editLink: 'Odkaz',
  editLinkHint: 'Táhněte rámeček na stránce a přidejte hypertextový odkaz',
  linkDialogTitle: 'Přidat odkaz',
  linkUrlLabel: 'Webová adresa',
  linkPageLabel: 'Nebo stránku v tomto dokumentu (1–{n})',
} satisfies Record<keyof typeof zh, string>
