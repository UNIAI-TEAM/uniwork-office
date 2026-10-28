import type { zh } from './zh'

export const cs = {
  backlinks: 'Zpětné odkazy',
  backlinksEmpty: 'Zatím žádná poznámka nelinkuje sem.',
  backlinksRefresh: 'Aktualizovat zpětné odkazy',
  graph: 'Zobrazení grafu',
  graphClose: 'Zavřít graf',
  graphEmpty: 'V trezoru ještě nejsou poznámky.',
  graphTruncated: 'Příliš poznámek: graf zobrazuje prvních {shown} z {total}.',
  suggestCreateNote: 'Vytvořit novou poznámku',
  tags: 'Štítky',
  tagsEmpty: 'V trezoru zatím nejsou žádné #štítky',
  blockLink: 'Kopírovat odkaz na blok',
  blockLinkCopied: 'Zkopírováno {link}',
  blockLinkNone: 'Tady není žádný blok k odkazování',
} satisfies Record<keyof typeof zh, string>
