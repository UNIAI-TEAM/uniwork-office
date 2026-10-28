import type { zh } from './zh'

export const pl = {
  searchMatchCase: 'Rozróżniaj wielkość liter',
  searchWholeWord: 'Całe słowa',
  commentsPanel: 'Komentarze',
  commentsFilter: 'Filtruj komentarze według tekstu lub autora',
  commentsEmpty: 'Brak komentarzy w tym dokumencie',
  commentsLoading: 'Wczytywanie komentarzy',
  editLink: 'Łącze',
  editLinkHint: 'Przeciągnij prostokąt na stronie, aby dodać hiperłącze',
  linkDialogTitle: 'Dodaj łącze',
  linkUrlLabel: 'Adres internetowy',
  linkPageLabel: 'Lub strona w tym dokumencie (1–{n})',
} satisfies Record<keyof typeof zh, string>
