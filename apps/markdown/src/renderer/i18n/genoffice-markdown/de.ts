import type { zh } from './zh'

export const de = {
  backlinks: 'Rückverweise',
  backlinksEmpty: 'Noch keine Notiz verweist hierher.',
  backlinksRefresh: 'Rückverweise aktualisieren',
  graph: 'Graphenansicht',
  graphClose: 'Graph schließen',
  graphEmpty: 'Der Tresor hat noch keine Notizen.',
  graphTruncated: 'Zu viele Notizen: Das Diagramm zeigt die ersten {shown} von {total}.',
  suggestCreateNote: 'Neue Notiz erstellen',
  tags: 'Schlagwörter',
  tagsEmpty: 'Noch keine #Schlagwörter im Vault',
  blockLink: 'Link zum Block kopieren',
  blockLinkCopied: '{link} kopiert',
  blockLinkNone: 'Hier gibt es keinen Block zum Verlinken',
  insertFootnote: 'Fußnote',
  statusWords: '{n} Wörter',
  statusChars: '{n} Zeichen',
  highlight: 'Hervorheben',
} satisfies Record<keyof typeof zh, string>
