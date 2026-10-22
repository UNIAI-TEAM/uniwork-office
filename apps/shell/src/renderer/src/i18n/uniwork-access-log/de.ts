import type { zh } from './zh'

export const de = {
  algMenu: 'Zugriffsprotokoll',
  algTitle: 'Zugriffsprotokoll',
  algDescription:
    'Wer das Dokument angesehen, heruntergeladen oder über einen Link geöffnet hat. Nur Verwalter können es lesen.',
  algManageOnly: 'Zum Lesen des Zugriffsprotokolls benötigen Sie Verwaltungsrechte.',
  algLoading: 'Protokoll wird geladen…',
  algError: 'Das Zugriffsprotokoll konnte nicht geladen werden.',
  algEmpty: 'Noch keine Zugriffe aufgezeichnet.',
  algFilterLabel: 'Aktion',
  algFilterAll: 'Alle Aktionen',
  algActionView: 'Ansehen',
  algActionDownload: 'Herunterladen',
  algActionExport: 'Exportieren',
  algActionLinkView: 'Über Link geöffnet',
  algActionUnknown: 'Sonstiges',
  algActorAnonymous: 'Anonym',
  algActorSystem: 'System',
  algActorUnknown: 'Unbekannt',
  algVersion: 'Version {no}',
} satisfies Record<keyof typeof zh, string>
