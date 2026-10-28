import type { zh } from './zh'

export const pl = {
  searchMatchCase: 'Rozróżniaj wielkość liter',
  searchWholeWord: 'Całe słowa',
  commentsPanel: 'Komentarze',
  commentsFilter: 'Filtruj komentarze według tekstu lub autora',
  commentsEmpty: 'Brak komentarzy w tym dokumencie',
  commentsLoading: 'Wczytywanie komentarzy',
} satisfies Record<keyof typeof zh, string>
