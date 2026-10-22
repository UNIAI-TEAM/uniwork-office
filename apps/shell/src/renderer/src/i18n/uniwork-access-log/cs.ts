import type { zh } from './zh'

export const cs = {
  algMenu: 'Protokol přístupů',
  algTitle: 'Protokol přístupů',
  algDescription:
    'Kdo dokument zobrazil, stáhl nebo otevřel přes odkaz. Číst jej mohou jen správci.',
  algManageOnly: 'Ke čtení protokolu přístupů potřebujete oprávnění ke správě.',
  algLoading: 'Načítání protokolu…',
  algError: 'Protokol přístupů se nepodařilo načíst.',
  algEmpty: 'Zatím nebyl zaznamenán žádný přístup.',
  algFilterLabel: 'Akce',
  algFilterAll: 'Všechny akce',
  algActionView: 'Zobrazení',
  algActionDownload: 'Stažení',
  algActionExport: 'Export',
  algActionLinkView: 'Otevřeno přes odkaz',
  algActionUnknown: 'Jiné',
  algActorAnonymous: 'Anonym',
  algActorSystem: 'Systém',
  algActorUnknown: 'Neznámý',
  algVersion: 'verze {no}',
} satisfies Record<keyof typeof zh, string>
