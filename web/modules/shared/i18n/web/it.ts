import type { zh } from './zh'

export const it = {
  webCancel: 'Annulla',
  webConflictTitle: 'Questo documento è stato modificato altrove',
  webConflictBody:
    'Le modifiche non sono ancora su UniWork e restano in questo browser finché non esci.',
  webConflictOverwrite: 'Sovrascrivi…',
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
  webDraftTitle: 'Ripristinare le modifiche non salvate?',
  webDraftBody:
    'Questo browser ha conservato una copia delle modifiche non salvate a questo documento. Ripristinarle o eliminarle?',
  webDraftOlder:
    'La copia si basa su una versione precedente del documento. Salvandola si sostituisce la versione più recente.',
  webDraftSavedAt: 'Copia conservata alle',
  webDraftKept: 'Questo browser conserva la copia finché non esci.',
  webDraftRestore: 'Ripristina',
  webDraftDiscard: 'Elimina',
  webSaveNetwork: 'Impossibile raggiungere UniWork. Controlla la connessione e riprova.',
  webSaveTimeout: 'Il salvataggio ha richiesto troppo tempo. Controlla la connessione e riprova.',
  webClose: 'Chiudi',
  webSaveUnauthorized: 'La sessione UniWork è scaduta. Accedi di nuovo e riprova a salvare.',
  webSaveForbidden: 'Non hai l’autorizzazione per salvare questo documento.',
  webSaveNotFound: 'Questo documento non esiste più o è stato spostato.',
  webSaveTooLarge: 'Il documento è troppo grande per essere salvato.',
  webSaveRateLimited: 'Troppe richieste. Attendi un momento e riprova.',
  webSaveServer: 'UniWork ha avuto un problema durante il salvataggio. Riprova tra un momento.',
  webSaveFailedGeneric: 'Impossibile salvare il documento. Riprova.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Le modifiche non sono ancora su UniWork e restano in questo browser finché non esci.',
  uwConflictReloadWebBody:
    'Il browser non conserva le bozze di conflitto. Scarica la tua versione per copiarla in seguito, oppure elimina le modifiche.',
  uwConflictDownloadThenReload: 'Scarica la mia versione, poi ricarica',
  uwConflictDiscardThenReload: 'Elimina le modifiche e ricarica',
  uwConflictMineFileSuffix: '(la mia versione)',
  uwConflictDownloadCheck:
    'Il browser ha ricevuto il file. Verifica che sia stato salvato, poi scegli Ricarica.',
  uwConflictSessionWeb:
    'La sessione è scaduta, quindi la sovrascrittura non è avvenuta. Le modifiche restano in questo browser; accedi di nuovo e riprova.',
  uwConflictTooLarge:
    'La tua versione supera il limite di dimensione di UniWork, quindi non è stato possibile sovrascrivere.',
  uwConflictDownloadTooLarge:
    'La tua versione supera il limite di dimensione di UniWork, quindi non può essere scaricata qui.',
  uwConflictDownloadFailed:
    'Impossibile scaricare la tua versione, quindi il documento non è stato ricaricato. Riprova.',
  uwConflictOfflineWeb:
    'Sei offline. Sul web serve una connessione; le modifiche restano in questo browser.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'La tua versione',
  uwConflictColServer: 'Versione su UniWork',
  uwConflictRowVersion: 'Versione',
  uwConflictRowTime: 'Ora',
  uwConflictRowBy: 'Salvato da',
  uwConflictMineUnsaved: 'Tu (non salvato)',
  uwConflictBasedOn: 'basato sulla versione {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Visualizza differenze',
  uwConflictDiffPending: 'Confronto in corso…',
  uwConflictDiffFailed: 'Impossibile confrontare le versioni in questo momento. Riprova più tardi.',
  uwConflictNoEdit: 'Non hai più l’accesso in modifica a questo documento.',
  uwConflictOverwriteTitle: 'Sovrascrivere con la tua versione?',
  uwConflictOverwriteConfirm:
    'UniWork creerà la versione {next} dalla tua copia. La versione {server} di {author} resta nella cronologia.',
  uwConflictOverwriteGo: 'Sovrascrivi',
  uwConflictBack: 'Indietro',
  uwConflictHeadMoved:
    'Nel frattempo UniWork ha ricevuto la versione {n}. La tabella è aggiornata; scegli di nuovo.',
  uwConflictReloadTitle: 'Ricarica l’ultima versione',
  uwConflictReloadGo: 'Ricarica',
  uwConflictSaveCopy: 'Salva come copia…',
  uwConflictSaveCopyName: '{name} (copia)',
  uwConflictSaveCopyTitle: 'Salvare come copia?',
  uwConflictSaveCopyConfirm:
    'UniWork creerà un nuovo documento dalla tua versione, con lo stesso proprietario e gli stessi accessi di questo documento. Il documento attuale e la versione {server} di {author} restano invariati.',
  uwConflictSaveCopyGo: 'Crea copia',
  uwConflictSaveCopyDone:
    'La tua versione è stata salvata come nuovo documento: {title}. Questo documento non è cambiato; puoi ancora ricaricare o sovrascrivere.',
  uwConflictSaveCopyFailed:
    'Impossibile creare la copia. Le modifiche sono ancora al sicuro; riprova.',
  uwConflictSaveCopyOffline:
    'Sei offline. Per creare una copia serve una connessione; le modifiche vengono conservate.',
  uwConflictReloadFailed:
    'Impossibile caricare l’ultima versione. Il documento non è cambiato; riprova.',
  uwConflictOverwriteFailed:
    'Impossibile sovrascrivere per ora. Il documento non è cambiato; riprova.',
  uwConflictClose: 'Chiudi',

  // S6 new-version bar
  uwRemoteRegion: 'Nuova versione',
  uwRemoteUpdated: 'Aggiornato alla versione {n}, salvata da {author} alle {time}.',
  uwRemoteUpdatedNoRev: 'Aggiornato all’ultima versione su UniWork.',
  uwRemoteNewerDirty:
    'Su UniWork c’è una versione più recente (versione {n}). Hai modifiche non salvate, quindi il documento non è stato ricaricato.',
  uwRemoteNewerAi:
    'Su UniWork c’è una versione più recente (versione {n}). UniWork AI è in esecuzione, quindi il documento non è stato ricaricato; i risultati dell’IA si applicano solo alla copia aperta.',
  uwRemoteNowClean:
    'Hai annullato tutte le modifiche. La versione {n} su UniWork è più recente della copia aperta.',
  uwRemoteStopAiConfirm:
    'Interrompere l’esecuzione di UniWork AI per ricaricare? Le modifiche già fatte dall’IA appartengono alla copia aperta.',
  uwRemoteWaitCommit: 'In attesa che termini il salvataggio in corso; poi potrai ricaricare.',
  uwRemoteReload: 'Ricarica l’ultima versione…',
  uwRemoteLater: 'Più tardi',
  uwRemoteClose: 'Chiudi',
  uwRemoteReloadFailed:
    'Impossibile caricare la versione {n}. Stai ancora visualizzando la versione precedente.',
  uwRemoteDeleted:
    'Questo documento è stato eliminato su UniWork. I salvataggi in coda si sono interrotti.',
  uwAuthorFallback: 'un membro',
  uwLockRegion: 'Stato del documento',
  uwActRetry: 'Riprova',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'Non hai più accesso a questo documento. Il salvataggio si è interrotto; le modifiche non salvate restano in questo browser finché non esci.',
  uwRemoteOrgBlockedWeb:
    'Impossibile salvare: {reason}. Le modifiche non salvate restano in questo browser finché non esci.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'documento archiviato',
  uwReasonSuspended: 'organizzazione sospesa',
  uwReasonDeactivated: 'il tuo account è disattivato in questa organizzazione',

  webSizeWarnChip: 'In prossimità del limite di {max} (attualmente {size}).',
  webSaveBlockTitle: 'Impossibile salvare su UniWork',
  webSaveBlockBody:
    'Questo documento supera {max}. Le tue modifiche sono ancora qui. Scarica la tua copia sul computer, quindi riduci le dimensioni delle immagini o dividi il documento.',
  webSaveBlockDownload: 'Scarica la mia copia',
  uwConflictTooLargeWithLimit:
    'La tua versione supera {max} (attualmente {size}). Chiudi questa finestra per ridurre le dimensioni del file oppure scegli “Ricarica l’ultima versione” per scaricare la tua versione.',
  uwConflictSaveCopyTooLarge:
    'La tua versione supera il limite di dimensione di UniWork, quindi non è stato possibile creare la copia. Chiudi questa finestra per ridurre le dimensioni del file oppure scegli “Ricarica l’ultima versione” per scaricare la tua versione.',
  uwConflictSaveCopyTooLargeWithLimit:
    'La tua versione supera {max} (attualmente {size}), quindi non è stato possibile creare la copia. Chiudi questa finestra per ridurre le dimensioni del file oppure scegli “Ricarica l’ultima versione” per scaricare la tua versione.',
} satisfies Record<keyof typeof zh, string>
