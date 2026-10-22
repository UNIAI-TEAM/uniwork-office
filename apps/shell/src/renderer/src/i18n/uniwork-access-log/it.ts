import type { zh } from './zh'

export const it = {
  algMenu: 'Registro degli accessi',
  algTitle: 'Registro degli accessi',
  algDescription:
    'Chi ha visualizzato, scaricato o aperto il documento tramite un link. Solo i gestori possono leggerlo.',
  algManageOnly: 'Per leggere il registro degli accessi serve il permesso di gestione.',
  algLoading: 'Caricamento del registro…',
  algError: 'Impossibile caricare il registro degli accessi.',
  algEmpty: 'Nessun accesso registrato finora.',
  algFilterLabel: 'Azione',
  algFilterAll: 'Tutte le azioni',
  algActionView: 'Visualizzazione',
  algActionDownload: 'Download',
  algActionExport: 'Esportazione',
  algActionLinkView: 'Aperto tramite link',
  algActionUnknown: 'Altro',
  algActorAnonymous: 'Anonimo',
  algActorSystem: 'Sistema',
  algActorUnknown: 'Sconosciuto',
  algVersion: 'versione {no}',
} satisfies Record<keyof typeof zh, string>
