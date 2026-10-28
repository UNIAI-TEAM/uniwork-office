import type { zh } from './zh'

export const nl = {
  backlinks: 'Terugverwijzingen',
  backlinksEmpty: 'Nog geen notities linken hierheen.',
  backlinksRefresh: 'Terugverwijzingen bijwerken',
  graph: 'Grafiekweergave',
  graphClose: 'Grafiek sluiten',
  graphEmpty: 'De kluis heeft nog geen notities.',
  graphTruncated: 'Te veel notities: de grafiek toont de eerste {shown} van {total}.',
  suggestCreateNote: 'Nieuwe notitie maken',
  tags: 'Labels',
  tagsEmpty: 'Nog geen #labels in de kluis',
  blockLink: 'Link naar blok kopiëren',
  blockLinkCopied: '{link} gekopieerd',
  blockLinkNone: 'Hier is geen blok om naar te linken',
  insertFootnote: 'Voetnoot',
  statusWords: '{n} woorden',
  statusChars: '{n} tekens',
  highlight: 'Markeren',
} satisfies Record<keyof typeof zh, string>
