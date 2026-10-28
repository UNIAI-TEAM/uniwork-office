import type { zh } from './zh'

export const de = {
  searchMatchCase: 'Groß-/Kleinschreibung beachten',
  searchWholeWord: 'Ganzes Wort',
  commentsPanel: 'Kommentare',
  commentsFilter: 'Kommentare nach Text oder Autor filtern',
  commentsEmpty: 'Noch keine Kommentare in diesem Dokument',
  commentsLoading: 'Kommentare werden geladen',
} satisfies Record<keyof typeof zh, string>
