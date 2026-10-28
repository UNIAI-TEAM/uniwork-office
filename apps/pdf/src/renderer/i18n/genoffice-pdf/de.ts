import type { zh } from './zh'

export const de = {
  searchMatchCase: 'Groß-/Kleinschreibung beachten',
  searchWholeWord: 'Ganzes Wort',
  commentsPanel: 'Kommentare',
  commentsFilter: 'Kommentare nach Text oder Autor filtern',
  commentsEmpty: 'Noch keine Kommentare in diesem Dokument',
  commentsLoading: 'Kommentare werden geladen',
  editLink: 'Link',
  editLinkHint: 'Ziehen Sie einen Rahmen auf der Seite, um einen Hyperlink hinzuzufügen',
  linkDialogTitle: 'Link hinzufügen',
  linkUrlLabel: 'Webadresse',
  linkPageLabel: 'Oder eine Seite in diesem Dokument (1–{n})',
} satisfies Record<keyof typeof zh, string>
