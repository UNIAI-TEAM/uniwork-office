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
} satisfies Record<keyof typeof zh, string>
