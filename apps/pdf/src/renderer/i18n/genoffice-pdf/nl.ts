import type { zh } from './zh'

export const nl = {
  searchMatchCase: 'Hoofdlettergevoelig',
  searchWholeWord: 'Alleen hele woorden',
  commentsPanel: 'Opmerkingen',
  commentsFilter: 'Opmerkingen filteren op tekst of auteur',
  commentsEmpty: 'Nog geen opmerkingen in dit document',
  commentsLoading: 'Opmerkingen laden',
} satisfies Record<keyof typeof zh, string>
