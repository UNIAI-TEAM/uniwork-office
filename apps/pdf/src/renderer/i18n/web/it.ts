import type { zh } from './zh'

export const it = {
  webCancel: 'Annulla',
  webConflictTitle: 'Questo documento è stato modificato altrove',
  webConflictBody:
    'Mentre modificavi è stata salvata una versione più recente. Vuoi sovrascriverla con la tua versione o ricaricare l’ultima versione e scartare le modifiche?',
  webConflictOverwrite: 'Sovrascrivi',
  webConflictReload: 'Ricarica l’ultima versione',
  webConflictNotSaved: 'il documento è stato modificato altrove',
  webFatalTitle: 'Impossibile aprire il documento',
  webFatalBody:
    'Modifica e salvataggio sono disattivati. Ricarica la pagina o riapri il documento da UniWork.',
  webNoHost: 'Questo editor funziona all’interno di UniWork. Apri il documento da UniWork.',
  webViewOnly: 'Sola lettura',
  webReloaded: "è stata ricaricata l'ultima versione e le tue modifiche sono state scartate",
  webViewOnlyNoSave: 'questo documento è di sola lettura',
  webMergeTitle: 'Unisci PDF',
  webMergeBody: '{count} PDF selezionati. Aggiungere un altro PDF o unire ora?',
  webMergeAdd: 'Aggiungi un altro PDF',
  webMergeNow: 'Unisci ora',
} satisfies Record<keyof typeof zh, string>
