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
  webViewOnlyNotSaved: 'Questo documento è di sola lettura e non può essere salvato',
  webNotUtf8:
    'Questo file non è testo UTF-8. Si apre in sola lettura perché il salvataggio non ne modifichi i byte',
} satisfies Record<keyof typeof zh, string>
