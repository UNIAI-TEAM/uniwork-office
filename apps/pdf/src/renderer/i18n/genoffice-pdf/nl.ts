import type { zh } from './zh'

export const nl = {
  searchMatchCase: 'Hoofdlettergevoelig',
  searchWholeWord: 'Alleen hele woorden',
  commentsPanel: 'Opmerkingen',
  commentsFilter: 'Opmerkingen filteren op tekst of auteur',
  commentsEmpty: 'Nog geen opmerkingen in dit document',
  commentsLoading: 'Opmerkingen laden',
  editLink: 'Koppeling',
  editLinkHint: 'Trek een kader op de pagina om een hyperlink toe te voegen',
  linkDialogTitle: 'Koppeling toevoegen',
  linkUrlLabel: 'Webadres',
  linkPageLabel: 'Of een pagina in dit document (1–{n})',
} satisfies Record<keyof typeof zh, string>
