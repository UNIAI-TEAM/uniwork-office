import type { zh } from './zh'

export const it = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Salvataggio in coda — non ancora su UniWork',
  uwChipQueuedNewer: 'Salvataggio in coda · modifiche più recenti',
  uwChipPausedAdmin: 'Salvataggio in coda · invio in pausa',
  uwChipReconciling: 'Verifica dell’ultimo salvataggio…',
  uwChipReconcileStuck: 'Serve assistenza per confermare il salvataggio',
  uwChipRemoteNewer: 'Versione più recente su UniWork',
  uwTipQueued:
    'Il salvataggio delle {time} è conservato al sicuro su questo computer e verrà inviato quando sarai online.',
  uwTipQueuedNewer:
    'Il salvataggio delle {time} è in attesa di invio. Le modifiche successive non ne fanno parte.',
  uwTipPausedAdmin:
    'L’amministratore ha messo in pausa l’invio. Il salvataggio resta su questo computer.',
  uwTipPausedUser:
    'Hai messo in pausa l’invio. Il salvataggio delle {time} resta su questo computer; scegli Riprendi invio nel centro di sincronizzazione.',
  uwTipReconciling:
    'Non è ancora chiaro se l’ultimo salvataggio sia arrivato su UniWork. L’app sta verificando e non creerà duplicati.',
  uwTipRemoteNewer: 'Hai modifiche non salvate, quindi il documento non è stato ricaricato.',
  uwTipFailed:
    'Questo salvataggio non verrà ritentato da solo: {reason}. Le modifiche restano su questo computer.',
  uwTipWaitAi: 'In attesa che l’IA finisca il passaggio corrente, poi salvataggio.',
  uwTipWaitAiLong:
    'L’IA non ha finito il passaggio corrente. Interrompi l’esecuzione dell’IA per salvare ora.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Visualizza coda',
  uwActSaveAgain: 'Salva di nuovo',
  uwActStopAi: 'Interrompi IA',
  uwActBack: 'Indietro',
  uwQueuePopWaiting: 'In attesa di salvataggio: delle {time} (basato sulla versione {base})',
  uwQueuePopNewer: 'Modifiche più recenti da allora — non inviate',
  uwQueueBlockedSave:
    'L’ultimo salvataggio è ancora in attesa. Potrai salvare di nuovo quando sarà terminato.',
  uwQueueFull:
    'Lo spazio di sincronizzazione su questo computer è pieno, quindi il salvataggio non è stato messo in coda. Le modifiche sono ancora nella finestra aperta; libera spazio nel centro di sincronizzazione.',
  uwQueueOpenCenter: 'Apri centro di sincronizzazione',
  uwQueueCancel: 'Annulla salvataggio…',
  uwQueueCancelConfirm:
    'Annullare il salvataggio in coda? Le modifiche restano su questo computer; il documento su UniWork non cambia.',
  uwQueueCancelled: 'Salvataggio in coda annullato. Le modifiche restano su questo computer.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'accedi di nuovo',
  uwReasonSignedOut: 'disconnesso',
  uwReasonForeign: 'appartiene a un altro account',
  uwReasonArchived: 'documento archiviato',
  uwReasonSuspended: 'organizzazione sospesa',
  uwReasonDeactivated: 'il tuo account è disattivato in questa organizzazione',
  uwReasonLease: 'accesso offline scaduto',
  uwReasonKeystore: 'il portachiavi di questo computer è bloccato',
  uwReasonClock: 'l’orologio è stato spostato indietro',
  uwReasonStoreFull: 'lo spazio di sincronizzazione di questo computer è pieno',
  uwReasonStoreNewer: 'serve una versione più recente dell’app',

  // S2 queue-row badges
  uwBadgeQueued: 'In attesa',
  uwBadgeWaitNetwork: 'In attesa di rete',
  uwBadgePausedUser: 'Messo in pausa da te',
  uwBadgePausedAdmin: 'Messo in pausa dall’amministratore',
  uwBadgeSending: 'Invio',
  uwBadgeReconciling: 'Verifica',
  uwBadgeReconcileStuck: 'Serve assistenza',
  uwBadgeConflict: 'Conflitto',
  uwBadgeBlocked: 'Bloccato',
  uwBadgeLocked: 'Bloccato',
  uwBadgeRevoked: 'Nessun accesso',
  uwBadgeDeleted: 'Eliminato',
  uwBadgeReconnect: 'Riconnessione necessaria',
  uwBadgeKeystore: 'Portachiavi bloccato',
  uwBadgeFailed: 'Invio non riuscito',
  uwBadgeSaved: 'Salvato',
  uwBadgeKeptDraft: 'Bozza conservata',
  uwBadgeMoved: 'Spostato',
  uwBadgeArchived: 'Archiviato',

  // S2 queue-row details
  uwRowQueued: 'Salvato {time} · basato sulla versione {base} · {size}',
  uwRowWaitNetwork: 'Verrà inviato quando sarai online',
  uwRowPausedUser: 'Verrà inviato quando sceglierai Riprendi invio',
  uwRowPausedAdmin: 'Verrà inviato quando l’amministratore riattiverà l’invio',
  uwRowUploading: 'Caricamento {done} / {total}',
  uwRowCommitting: 'Creazione della versione',
  uwRowReconciling:
    'Il risultato dell’invio delle {time} non è ancora chiaro. Verifica con UniWork in corso.',
  uwRowReconcileStuck:
    'Tentativi di verifica: {count}, ancora nessun risultato. L’app non reinvierà; invia il codice di assistenza all’amministratore.',
  uwStuckDiscardConfirm:
    'Eliminare questo salvataggio? Se è già arrivato su UniWork, quella versione resta; la tua copia viene conservata come bozza nel centro di sincronizzazione.',
  uwRowConflict: 'La versione {n} è stata salvata da {author} alle {time}',
  uwRowFailed: 'Invio non riuscito: {reason}',
  uwRowBlocked: 'Impossibile salvare: {reason}',
  uwRowCommitted: 'Versione {n} · {time}',
  uwRowKeptDraft: 'Conservato al ricaricamento delle {time}',
  uwRowMoved: 'Il documento è stato spostato in {workspace}',
  uwRowArchived: 'Il documento è stato archiviato su UniWork',

  // S2 row actions
  uwActDiscard: 'Elimina',
  uwActDiscardSave: 'Elimina salvataggio…',
  uwActSendNow: 'Invia ora',
  uwActRecheck: 'Verifica di nuovo',
  uwActGuide: 'Guida',
  uwActOpenToResolve: 'Apri per risolvere',
  uwActCopySupport: 'Copia codice di assistenza',
  uwActDownloadMine: 'Scarica la mia versione',
  uwActOpenDraft: 'Apri bozza',
  uwActDiscardDraft: 'Elimina bozza…',
  uwActSignInAgain: 'Accedi di nuovo',
  uwActSignIn: 'Accedi',
  uwActSwitchAccount: 'Cambia account',
  uwActReconnect: 'Riconnetti',
  uwActDetails: 'Dettagli',
  uwActOpen: 'Apri',
  uwDiscardDraftConfirm:
    'Eliminare questa bozza? Le sue modifiche verranno rimosse da questo computer e non potranno essere recuperate.',

  // Sign-out prompt
  uwSignOutTitle: 'Uscire da UniWork?',
  uwSignOutBody:
    'Documenti con modifiche non salvate o salvataggi in coda: {count}. Restano bloccati su questo computer e solo il tuo account potrà riaprirli.',
  uwSignOutKeystore:
    'Il portachiavi del computer è bloccato, quindi le modifiche non salvate esistono solo nelle finestre aperte. Uscire ora le elimina; ciò che è già conservato cifrato resta. Per mantenerle, sblocca prima il computer.',
  uwSignOutGo: 'Esci',
  uwSignOutWaiting: 'Completamento del salvataggio in corso prima di uscire…',
  uwSignOutCaptureFailed:
    'Alcune modifiche non salvate non sono state acquisite in tempo; l’ultima versione salvata automaticamente viene conservata per il tuo account.',

  // S2 sync center
  uwSyncTitle: 'Centro di sincronizzazione',
  uwSyncOpenFromSettings: 'Centro di sincronizzazione',
  uwSyncOnline: 'Connesso a UniWork · sincronizzato {time}',
  uwSyncOffline: 'Offline · ultima sincronizzazione {time}',
  uwSyncPaused: 'Invio in pausa — i nuovi salvataggi resteranno in attesa',
  uwSyncAdminPaused:
    'L’amministratore ha messo in pausa l’invio. I salvataggi restano su questo computer.',
  uwSyncFeedOff:
    'Gli avvisi di nuova versione sono in pausa. UniWork controlla comunque i conflitti quando salvi.',
  uwSyncResynced: 'Risincronizzato completamente alle {time}',
  uwSyncResyncFailed:
    'Impossibile risincronizzare dopo diversi tentativi. Gli avvisi di nuova versione sono in pausa; UniWork controlla comunque i conflitti quando salvi.',
  uwSyncSignedOut: 'Sei disconnesso. Elementi conservati bloccati su questo computer: {count}.',
  uwSyncSignedOutEmpty: 'Sei disconnesso.',
  uwSyncSessionExpired: 'La sessione è scaduta. Accedi di nuovo per continuare l’invio.',
  uwSyncOtherOrg: 'Salvataggi in attesa in un’altra organizzazione: {count}',
  uwSyncStoreBudget: 'Spazio di sincronizzazione su questo computer: {used} di {cap}',
  uwSyncStoreError: 'Impossibile leggere la coda su questo computer. Non è stato eliminato nulla.',
  uwSyncNow: 'Sincronizza ora',
  uwSyncPause: 'Metti in pausa l’invio',
  uwSyncResume: 'Riprendi invio',
  uwSyncNowOffline: 'Per sincronizzare serve una connessione.',
  uwSyncTabAttention: 'Da gestire',
  uwSyncTabQueue: 'In attesa di salvataggio',
  uwSyncTabOffline: 'Disponibile offline',
  uwSyncTabRecent: 'Salvati di recente',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Documento',
  uwSyncColState: 'Stato',
  uwSyncColDetail: 'Dettagli',
  uwSyncColActions: 'Azioni',
  uwSyncMoreActions: 'Altre azioni per {doc}',
  uwSyncEmptyQueue: 'Nessun salvataggio in attesa.',
  uwSyncEmptyAttention: 'Niente da gestire.',
  uwSyncEmptyRecent: 'Nessun salvataggio recente.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Rendi disponibile offline',
  uwOfflineUnpin: 'Rimuovi copia offline',
  uwOfflineUnpinShort: 'Sblocca',
  uwOfflineAdd: 'Aggiungi documenti…',
  uwOfflineUsage: 'In uso {used} di {cap} su questo computer',
  uwOfflineEmpty: 'Nessun documento è ancora disponibile offline.',
  uwOfflineCapReached:
    'La libreria offline su questo computer ha raggiunto il limite: spazio {cap}; numero massimo di documenti: {maxDocs}. Rimuovi una copia offline per aggiungerne un’altra.',
  uwOfflineReady: 'Disponibile offline',
  uwOfflineBadgeWaiting: 'In attesa di rete',
  uwOfflineBadgeDownloading: 'Download in corso',
  uwOfflineBadgeVerifying: 'Verifica',
  uwOfflineBadgeUpdate: 'Aggiornamento disponibile',
  uwOfflineBadgeInterrupted: 'Non pronto',
  uwOfflineBadgeDiskFull: 'Spazio insufficiente',
  uwOfflineBadgeCorrupt: 'Download danneggiato',
  uwOfflineBadgeLeaseSoon: 'Accesso offline in scadenza',
  uwOfflineBadgeViewOnly: 'Disponibile offline · sola visualizzazione',
  uwOfflineRowWaiting: 'Verrà scaricato quando sarai online',
  uwOfflineRowProgress: '{done} di {total}',
  uwOfflineRowProgressAria: '{done} di {total}',
  uwOfflineRowVerifying: 'Verifica dell’integrità',
  uwOfflineRowReady: 'Versione {n} · {size} · accesso offline fino a {datetime}',
  uwOfflineRowUpdate:
    'La versione {n} verrà scaricata quando sarai online; la versione {old} funziona ancora',
  uwOfflineRowUpdateKept:
    'Impossibile aggiornare alla versione {n}: {reason}. La versione {old} funziona ancora.',
  uwOfflineRowInterrupted:
    'Il download è stato interrotto. La copia precedente (se presente) funziona ancora.',
  uwOfflineRowDiskFull: 'Servono altri {size}. La copia precedente viene conservata.',
  uwOfflineRowCorrupt: 'La copia danneggiata è stata rimossa. Scaricala di nuovo.',
  uwOfflineRowLeaseSoon: 'Connettiti prima di {datetime} per rinnovare',
  uwOfflineRowRevoked:
    'Non hai più accesso a questo documento. La copia scaricata è stata rimossa; le bozze restano bloccate.',
  uwOfflineRowDeleted:
    'Il documento è stato eliminato su UniWork. La copia scaricata è stata rimossa; le bozze restano bloccate.',
  uwOfflineRowArchived:
    'Il documento è stato archiviato; la copia qui si apre fino alla fine dell’accesso offline.',
  uwOfflineRowMoved: 'Spostato in {workspace}; la copia qui funziona ancora.',
  uwOfflineRowViewOnly: 'Versione {n} · sola visualizzazione · accesso offline fino a {datetime}',
  uwOfflineReadyAnnounce: 'Disponibile offline: {doc}',
  uwOfflineUnpinConfirm:
    'La copia scaricata verrà rimossa da questo computer. Bozze e salvataggi in coda vengono conservati.',
  uwOfflineCancelDownload: 'Annulla download',
  uwOfflineDownloadNow: 'Scarica ora',
  uwOfflineOpenFolder: 'Apri cartella di archiviazione',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Riconnessione necessaria',
  uwLockKeystoreTitle: 'Il portachiavi di questo computer è bloccato',
  uwLockClockTitle: 'Verifica dell’ora necessaria',
  uwLockRevokedTitle: 'Nessun accesso',
  uwLockDeletedTitle: 'Documento eliminato',
  uwLockForeignTitle: 'Appartiene a un altro account',
  uwLockOrgTitle: 'Impossibile aprire in questa organizzazione',
  uwLockExpired:
    'L’accesso offline è scaduto. Il contenuto resta cifrato; connettiti per riaprirlo.',
  uwLockLibraryOff:
    'L’amministratore ha disattivato i documenti offline, quindi l’accesso offline non può essere rinnovato. Le bozze restano bloccate nel centro di sincronizzazione.',
  uwLockKeystore:
    'Il portachiavi del computer è bloccato, quindi il contenuto cifrato non può essere aperto. Sbloccalo e riprova; non è stato eliminato nulla.',
  uwLockClock:
    'L’orologio del computer è stato spostato indietro, quindi l’accesso offline è bloccato. Connettiti perché UniWork possa verificare l’ora.',
  uwLockForeign:
    'Questo documento appartiene a un altro account su questo computer. Passa a quell’account per aprirlo.',
  uwLockSuspended:
    'L’organizzazione è sospesa. Il contenuto resta cifrato; contatta l’amministratore.',
  uwLockDeactivated:
    'Il tuo account è disattivato in questa organizzazione. Il contenuto resta cifrato; contatta l’amministratore.',
  uwLockSignedOutTitle: 'Sei disconnesso',
  uwLockSignedOut:
    'Il contenuto resta bloccato su questo computer. Accedi con lo stesso account per riaprirlo.',
  uwLockRegion: 'Stato del documento',
  uwLockWhileOpen:
    'Il documento è stato bloccato mentre era aperto. Le modifiche non salvate restano cifrate; non puoi salvare né copiare finché non viene sbloccato.',
  uwLockWhileOpenRam:
    'Il documento è stato bloccato mentre era aperto e questo computer non può ancora conservare le modifiche in sicurezza. Esistono solo in questa finestra (sola visualizzazione); chiudendola andranno perse.',
  uwLockOtherWindow:
    'Questo documento è aperto in modifica in un’altra finestra. Questa finestra è di sola visualizzazione.',
  uwLockOtherWindowGone:
    'La finestra che modificava questo documento non risponde più. Puoi modificarlo in questa finestra.',
  uwLockGoToWindow: 'Vai a quella finestra',
  uwLockTakeEdit: 'Modifica in questa finestra',

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

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Questo documento è stato modificato altrove',
  uwConflictBody: 'Le modifiche non sono ancora su UniWork e sono al sicuro su questo computer.',
  uwConflictReload: 'Ricarica l’ultima versione',
  uwConflictOverwrite: 'Sovrascrivi…',
  uwConflictCancel: 'Annulla',
  uwConflictKeepUnavailable:
    'Questo computer non può conservare una bozza al momento (spazio di sincronizzazione pieno o portachiavi bloccato).',
  uwConflictOfflineDesktop:
    'Sei offline e l’ultima versione non è su questo computer, quindi non è ancora possibile ricaricare.',
  uwConflictReloadDesktopBody:
    'Scegli cosa succede alle tue modifiche prima che venga caricata la versione {n}.',
  uwConflictKeepDraft: 'Conserva la mia versione come bozza',
  uwConflictDiscard: 'Elimina le mie modifiche',
  uwConflictKeepDraftHint:
    'La bozza resta nel centro di sincronizzazione per essere vista o copiata; non viene mai applicata automaticamente alla nuova versione.',
  uwConflictDraftCapReached:
    'Questo documento ha raggiunto il numero massimo di bozze conservate: {cap}. Elimina una bozza vecchia nel centro di sincronizzazione per conservarne un’altra.',

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

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'Il salvataggio precedente richiede assistenza, quindi non puoi ancora ricaricare né sovrascrivere. Apri il centro di sincronizzazione per risolverlo.',
  uwRemoteRevoked:
    'Non hai più accesso a questo documento. Il salvataggio si è interrotto; le modifiche non salvate restano bloccate su questo computer.',
} satisfies Record<keyof typeof zh, string>
