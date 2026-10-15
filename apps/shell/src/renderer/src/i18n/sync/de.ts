import type { zh } from './zh'

export const de = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Speichern eingereiht – noch nicht in UniWork',
  uwChipQueuedNewer: 'Speichern eingereiht · neuere Änderungen',
  uwChipPausedAdmin: 'Speichern eingereiht · Senden pausiert',
  uwChipReconciling: 'Letztes Speichern wird geprüft…',
  uwChipReconcileStuck: 'Support nötig, um das Speichern zu bestätigen',
  uwChipRemoteNewer: 'Neuere Version in UniWork',
  uwTipQueued:
    'Ihr Speicherstand von {time} bleibt sicher auf diesem Computer und wird gesendet, sobald Sie online sind.',
  uwTipQueuedNewer:
    'Der Speicherstand von {time} wartet auf das Senden. Spätere Änderungen gehören nicht dazu.',
  uwTipPausedAdmin:
    'Ihr Administrator hat das Senden pausiert. Der Speicherstand bleibt auf diesem Computer.',
  uwTipPausedUser:
    'Sie haben das Senden pausiert. Der Speicherstand von {time} bleibt auf diesem Computer; wählen Sie im Synchronisierungscenter „Senden fortsetzen“.',
  uwTipReconciling:
    'Noch ist unklar, ob das letzte Speichern UniWork erreicht hat. Die App prüft das und legt kein Duplikat an.',
  uwTipRemoteNewer:
    'Sie haben ungespeicherte Änderungen, daher wurde das Dokument nicht neu geladen.',
  uwTipFailed:
    'Dieses Speichern wird nicht automatisch wiederholt: {reason}. Ihre Änderungen bleiben auf diesem Computer.',
  uwTipWaitAi: 'Warten, bis die KI ihren aktuellen Schritt beendet, dann wird gespeichert.',
  uwTipWaitAiLong:
    'Die KI hat ihren aktuellen Schritt noch nicht beendet. Stoppen Sie den KI-Lauf, um jetzt zu speichern.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Warteschlange anzeigen',
  uwActSaveAgain: 'Erneut speichern',
  uwActStopAi: 'KI stoppen',
  uwActBack: 'Zurück',
  uwQueuePopWaiting: 'Wartet auf Speichern: von {time} (basiert auf Version {base})',
  uwQueuePopNewer: 'Neuere Änderungen seitdem – nicht gesendet',
  uwQueueBlockedSave:
    'Ihr letztes Speichern wartet noch. Sie können erneut speichern, sobald es abgeschlossen ist.',
  uwQueueFull:
    'Der Synchronisierungsspeicher auf diesem Computer ist voll, daher wurde das Speichern nicht eingereiht. Ihre Änderungen sind noch im geöffneten Fenster; geben Sie im Synchronisierungscenter Speicherplatz frei.',
  uwQueueOpenCenter: 'Synchronisierungscenter öffnen',
  uwQueueCancel: 'Speichern abbrechen…',
  uwQueueCancelConfirm:
    'Eingereihtes Speichern abbrechen? Ihre Änderungen bleiben auf diesem Computer; das Dokument in UniWork ändert sich nicht.',
  uwQueueCancelGo: 'Speichern abbrechen',
  uwQueueCancelled:
    'Eingereihtes Speichern abgebrochen. Ihre Änderungen bleiben auf diesem Computer.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'erneut anmelden',
  uwReasonSignedOut: 'abgemeldet',
  uwReasonForeign: 'gehört zu einem anderen Konto',
  uwReasonArchived: 'Dokument archiviert',
  uwReasonSuspended: 'Organisation gesperrt',
  uwReasonDeactivated: 'Ihr Konto ist in dieser Organisation deaktiviert',
  uwReasonLease: 'Offlinezugriff abgelaufen',
  uwReasonKeystore: 'der Schlüsselbund dieses Computers ist gesperrt',
  uwReasonClock: 'die Uhr wurde zurückgestellt',
  uwReasonStoreFull: 'der Synchronisierungsspeicher dieses Computers ist voll',
  uwReasonStoreNewer: 'eine neuere App-Version ist erforderlich',

  // S2 queue-row badges
  uwBadgeQueued: 'Wartet',
  uwBadgeWaitNetwork: 'Wartet auf Netzwerk',
  uwBadgePausedUser: 'Von Ihnen pausiert',
  uwBadgePausedAdmin: 'Vom Administrator pausiert',
  uwBadgeSending: 'Wird gesendet',
  uwBadgeReconciling: 'Wird geprüft',
  uwBadgeReconcileStuck: 'Support nötig',
  uwBadgeConflict: 'Konflikt',
  uwBadgeBlocked: 'Blockiert',
  uwBadgeLocked: 'Gesperrt',
  uwBadgeRevoked: 'Kein Zugriff',
  uwBadgeDeleted: 'Gelöscht',
  uwBadgeReconnect: 'Neu verbinden nötig',
  uwBadgeKeystore: 'Schlüsselbund gesperrt',
  uwBadgeFailed: 'Senden fehlgeschlagen',
  uwBadgeSaved: 'Gespeichert',
  uwBadgeKeptDraft: 'Behaltener Entwurf',
  uwBadgeMoved: 'Verschoben',
  uwBadgeArchived: 'Archiviert',

  // S2 queue-row details
  uwRowQueued: 'Gespeichert {time} · basiert auf Version {base} · {size}',
  uwRowWaitNetwork: 'Wird gesendet, sobald Sie online sind',
  uwRowPausedUser: 'Wird gesendet, wenn Sie „Senden fortsetzen“ wählen',
  uwRowPausedAdmin: 'Wird gesendet, wenn Ihr Administrator das Senden wieder einschaltet',
  uwRowUploading: 'Hochladen {done} / {total}',
  uwRowCommitting: 'Version wird erstellt',
  uwRowReconciling: 'Das Ergebnis des Sendens um {time} ist noch unklar. Wird bei UniWork geprüft.',
  uwRowReconcileStuck:
    'Abgleichversuche: {count}, noch kein Ergebnis. Die App sendet nicht erneut; senden Sie den Supportcode an Ihren Administrator.',
  uwStuckDiscardConfirm:
    'Dieses Speichern verwerfen? Falls es UniWork schon erreicht hat, bleibt diese Version erhalten; Ihre Kopie wird als Entwurf im Synchronisierungscenter behalten.',
  uwRowConflict: 'Version {n} wurde von {author} um {time} gespeichert',
  uwRowFailed: 'Senden fehlgeschlagen: {reason}',
  uwRowBlocked: 'Speichern nicht möglich: {reason}',
  uwRowCommitted: 'Version {n} · {time}',
  uwRowKeptDraft: 'Beim Neuladen um {time} behalten',
  uwRowMoved: 'Das Dokument wurde nach {workspace} verschoben',
  uwRowArchived: 'Das Dokument wurde in UniWork archiviert',

  // S2 row actions
  uwActDiscard: 'Verwerfen',
  uwActDiscardSave: 'Speichern verwerfen…',
  uwActSendNow: 'Jetzt senden',
  uwActRecheck: 'Erneut prüfen',
  uwActGuide: 'Anleitung',
  uwActOpenToResolve: 'Zum Lösen öffnen',
  uwActCopySupport: 'Supportcode kopieren',
  uwActDownloadMine: 'Meine Version herunterladen',
  uwActOpenDraft: 'Entwurf öffnen',
  uwActDiscardDraft: 'Entwurf verwerfen…',
  uwActSignInAgain: 'Erneut anmelden',
  uwActSignIn: 'Anmelden',
  uwActSwitchAccount: 'Konto wechseln',
  uwActReconnect: 'Neu verbinden',
  uwActDetails: 'Details',
  uwActOpen: 'Öffnen',
  uwDiscardDraftConfirm:
    'Diesen Entwurf verwerfen? Seine Änderungen werden von diesem Computer entfernt und können nicht wiederhergestellt werden.',

  // Sign-out prompt
  uwSignOutTitle: 'Von UniWork abmelden?',
  uwSignOutBody:
    'Dokumente mit ungespeicherten Änderungen oder eingereihtem Speichern: {count}. Sie bleiben auf diesem Computer gesperrt und nur Ihr Konto kann sie wieder öffnen.',
  uwSignOutKeystore:
    'Der Schlüsselbund des Computers ist gesperrt, daher gibt es ungespeicherte Änderungen nur in geöffneten Fenstern. Wenn Sie sich jetzt abmelden, werden sie verworfen; bereits verschlüsselt Behaltenes bleibt. Entsperren Sie zuerst den Computer, um sie zu behalten.',
  uwSignOutGo: 'Abmelden',
  uwSignOutWaiting: 'Laufendes Speichern wird vor dem Abmelden abgeschlossen…',
  uwSignOutCaptureFailed:
    'Einige ungespeicherte Änderungen konnten nicht rechtzeitig erfasst werden; die zuletzt gespeicherte oder automatisch gespeicherte Version bleibt für dein Konto erhalten.',
  uwSwitchLostTitle:
    'Einige nicht gespeicherte Änderungen des vorherigen Kontos sind verloren gegangen',
  uwSwitchLostBody:
    'Auf diesem Computer hat sich ein anderes Konto angemeldet, daher wurde das vorherige Konto gesperrt. Dokumente, deren nicht gespeicherte Änderungen nicht behalten werden konnten: {count}. Alles andere bleibt für dieses Konto gesperrt auf diesem Computer.',
  uwSwitchLostOk: 'OK',

  // S2 sync center
  uwSyncTitle: 'Synchronisierungscenter',
  uwSyncOpenFromSettings: 'Synchronisierungscenter',
  uwSyncOnline: 'Mit UniWork verbunden · synchronisiert {time}',
  uwSyncOffline: 'Offline · zuletzt synchronisiert {time}',
  uwSyncOnlineNoTime: 'Mit UniWork verbunden',
  uwSyncOfflineNoTime: 'Offline',
  uwSyncPaused: 'Senden pausiert – neue Speicherstände warten',
  uwSyncAdminPaused:
    'Ihr Administrator hat das Senden pausiert. Speicherstände bleiben auf diesem Computer.',
  uwSyncFeedOff:
    'Hinweise auf neue Versionen sind pausiert. UniWork prüft beim Speichern weiterhin auf Konflikte.',
  uwSyncResynced: 'Vollständig neu synchronisiert um {time}',
  uwSyncResyncFailed:
    'Neu synchronisieren nach mehreren Versuchen fehlgeschlagen. Hinweise auf neue Versionen sind pausiert; UniWork prüft beim Speichern weiterhin auf Konflikte.',
  uwSyncSignedOut: 'Sie sind abgemeldet. Gesperrt auf diesem Computer behaltene Elemente: {count}.',
  uwSyncSignedOutEmpty: 'Sie sind abgemeldet.',
  uwSyncSessionExpired:
    'Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an, um weiter zu senden.',
  uwSyncOtherOrg: 'Wartende Speicherstände in einer anderen Organisation: {count}',
  uwSyncStoreBudget: 'Synchronisierungsspeicher auf diesem Computer: {used} von {cap}',
  uwSyncStoreError:
    'Die Warteschlange auf diesem Computer konnte nicht gelesen werden. Es wurde nichts gelöscht.',
  uwSyncNow: 'Jetzt synchronisieren',
  uwSyncPause: 'Senden pausieren',
  uwSyncResume: 'Senden fortsetzen',
  uwSyncNowOffline: 'Zum Synchronisieren ist eine Verbindung nötig.',
  uwSyncTabAttention: 'Erfordert Aufmerksamkeit',
  uwSyncTabQueue: 'Wartet auf Speichern',
  uwSyncTabOffline: 'Offline verfügbar',
  uwSyncTabRecent: 'Kürzlich gespeichert',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Dokument',
  uwSyncColState: 'Status',
  uwSyncColDetail: 'Details',
  uwSyncColActions: 'Aktionen',
  uwSyncMoreActions: 'Weitere Aktionen für {doc}',
  uwSyncEmptyQueue: 'Nichts wartet auf das Speichern.',
  uwSyncEmptyAttention: 'Nichts erfordert Aufmerksamkeit.',
  uwSyncEmptyRecent: 'Keine kürzlichen Speicherstände.',
  uwSyncActionFailed: 'Das hat nicht geklappt. Nichts wurde gelöscht; versuchen Sie es erneut.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Offline verfügbar machen',
  uwOfflineUnpin: 'Offlinekopie entfernen',
  uwOfflineUnpinShort: 'Lösen',
  uwOfflineAdd: 'Dokumente hinzufügen…',
  uwOfflineUsage: '{used} von {cap} auf diesem Computer belegt',
  uwOfflineEmpty: 'Noch keine Dokumente offline verfügbar.',
  uwOfflineCapReached:
    'Die Offlinebibliothek auf diesem Computer ist am Limit: Speicher {cap}; maximale Dokumente: {maxDocs}. Entfernen Sie eine Offlinekopie, um eine weitere hinzuzufügen.',
  uwOfflineReady: 'Offline verfügbar',
  uwOfflineBadgeWaiting: 'Wartet auf Netzwerk',
  uwOfflineBadgeDownloading: 'Wird heruntergeladen',
  uwOfflineBadgeVerifying: 'Wird überprüft',
  uwOfflineBadgeUpdate: 'Update verfügbar',
  uwOfflineBadgeInterrupted: 'Nicht bereit',
  uwOfflineBadgeDiskFull: 'Nicht genug Speicherplatz',
  uwOfflineBadgeCorrupt: 'Download beschädigt',
  uwOfflineBadgeLeaseSoon: 'Offlinezugriff endet bald',
  uwOfflineBadgeViewOnly: 'Offline verfügbar · nur Ansicht',
  uwOfflineRowWaiting: 'Wird heruntergeladen, sobald Sie online sind',
  uwOfflineRowProgress: '{done} von {total}',
  uwOfflineRowProgressAria: '{done} von {total}',
  uwOfflineRowVerifying: 'Integrität wird geprüft',
  uwOfflineRowReady: 'Version {n} · {size} · Offlinezugriff bis {datetime}',
  uwOfflineRowUpdate:
    'Version {n} wird heruntergeladen, sobald Sie online sind; Version {old} funktioniert weiterhin',
  uwOfflineRowUpdateKept:
    'Aktualisierung auf Version {n} fehlgeschlagen: {reason}. Version {old} funktioniert weiterhin.',
  uwOfflineRowInterrupted:
    'Der Download wurde unterbrochen. Die ältere Kopie (falls vorhanden) funktioniert weiterhin.',
  uwOfflineRowDiskFull: '{size} mehr benötigt. Die ältere Kopie bleibt erhalten.',
  uwOfflineRowCorrupt: 'Die beschädigte Kopie wurde entfernt. Laden Sie sie erneut herunter.',
  uwOfflineRowLeaseSoon: 'Verbinden Sie sich vor {datetime}, um zu verlängern',
  uwOfflineRowRevoked:
    'Sie haben keinen Zugriff mehr auf dieses Dokument. Die heruntergeladene Kopie wurde entfernt; Entwürfe bleiben gesperrt.',
  uwOfflineRowDeleted:
    'Das Dokument wurde in UniWork gelöscht. Die heruntergeladene Kopie wurde entfernt; Entwürfe bleiben gesperrt.',
  uwOfflineRowArchived:
    'Das Dokument wurde archiviert; die Kopie hier lässt sich bis zum Ende des Offlinezugriffs öffnen.',
  uwOfflineRowMoved: 'Nach {workspace} verschoben; die Kopie hier funktioniert weiterhin.',
  uwOfflineRowViewOnly: 'Version {n} · nur Ansicht · Offlinezugriff bis {datetime}',
  uwOfflineReadyAnnounce: 'Offline verfügbar: {doc}',
  uwOfflineUnpinConfirm:
    'Die heruntergeladene Kopie wird von diesem Computer entfernt. Entwürfe und eingereihte Speicherstände bleiben erhalten.',
  uwOfflineCancelDownload: 'Download abbrechen',
  uwOfflineDownloadNow: 'Jetzt herunterladen',
  uwOfflineOpenFolder: 'Speicherordner öffnen',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Neu verbinden nötig',
  uwLockKeystoreTitle: 'Der Schlüsselbund dieses Computers ist gesperrt',
  uwLockClockTitle: 'Zeitprüfung nötig',
  uwLockRevokedTitle: 'Kein Zugriff',
  uwLockDeletedTitle: 'Dokument gelöscht',
  uwLockForeignTitle: 'Gehört zu einem anderen Konto',
  uwLockOrgTitle: 'In dieser Organisation nicht zu öffnen',
  uwLockExpired:
    'Der Offlinezugriff ist abgelaufen. Der Inhalt bleibt verschlüsselt; verbinden Sie sich, um ihn wieder zu öffnen.',
  uwLockLibraryOff:
    'Ihr Administrator hat Offlinedokumente deaktiviert, daher kann der Offlinezugriff nicht verlängert werden. Entwürfe bleiben im Synchronisierungscenter gesperrt.',
  uwLockKeystore:
    'Der Schlüsselbund des Computers ist gesperrt, daher kann der verschlüsselte Inhalt nicht geöffnet werden. Entsperren Sie ihn und versuchen Sie es erneut; es wurde nichts gelöscht.',
  uwLockClock:
    'Die Uhr des Computers wurde zurückgestellt, daher ist der Offlinezugriff gesperrt. Verbinden Sie sich, damit UniWork die Zeit prüfen kann.',
  uwLockForeign:
    'Dieses Dokument gehört zu einem anderen Konto auf diesem Computer. Wechseln Sie zu diesem Konto, um es zu öffnen.',
  uwLockSuspended:
    'Die Organisation ist gesperrt. Der Inhalt bleibt verschlüsselt; wenden Sie sich an Ihren Administrator.',
  uwLockDeactivated:
    'Ihr Konto ist in dieser Organisation deaktiviert. Der Inhalt bleibt verschlüsselt; wenden Sie sich an Ihren Administrator.',
  uwLockSignedOutTitle: 'Sie sind abgemeldet',
  uwLockSignedOut:
    'Der Inhalt bleibt auf diesem Computer gesperrt. Melden Sie sich mit demselben Konto an, um ihn wieder zu öffnen.',
  uwLockRegion: 'Dokumentstatus',
  uwLockWhileOpen:
    'Das Dokument wurde gesperrt, während es geöffnet war. Ungespeicherte Änderungen bleiben verschlüsselt erhalten; bis zum Entsperren können Sie weder speichern noch kopieren.',
  uwLockWhileOpenRam:
    'Das Dokument wurde gesperrt, während es geöffnet war, und dieser Computer kann Ihre Änderungen noch nicht sicher aufbewahren. Sie existieren nur in diesem Fenster (nur Ansicht); beim Schließen gehen sie verloren.',
  uwLockOtherWindow:
    'Dieses Dokument ist in einem anderen Fenster zum Bearbeiten geöffnet. Dieses Fenster ist nur zur Ansicht.',
  uwLockOtherWindowGone:
    'Das Fenster, in dem dieses Dokument bearbeitet wurde, reagiert nicht mehr. Sie können in diesem Fenster bearbeiten.',
  uwLockGoToWindow: 'Zu diesem Fenster wechseln',
  uwLockTakeEdit: 'In diesem Fenster bearbeiten',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Ihre Version',
  uwConflictColServer: 'Version in UniWork',
  uwConflictRowVersion: 'Version',
  uwConflictRowTime: 'Zeit',
  uwConflictRowBy: 'Gespeichert von',
  uwConflictMineUnsaved: 'Sie (nicht gespeichert)',
  uwConflictBasedOn: 'basiert auf Version {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Unterschiede anzeigen',
  uwConflictNoEdit: 'Sie haben keine Bearbeitungsrechte mehr für dieses Dokument.',
  uwConflictOverwriteTitle: 'Mit Ihrer Version überschreiben?',
  uwConflictOverwriteConfirm:
    'UniWork erstellt aus Ihrer Kopie Version {next}. Version {server} von {author} bleibt im Verlauf.',
  uwConflictOverwriteGo: 'Überschreiben',
  uwConflictBack: 'Zurück',
  uwConflictHeadMoved:
    'Inzwischen hat UniWork Version {n} erhalten. Die Tabelle ist aktualisiert; wählen Sie erneut.',
  uwConflictReloadTitle: 'Neueste Version laden',
  uwConflictReloadGo: 'Neu laden',
  uwConflictSaveCopy: 'Als Kopie speichern…',
  uwConflictSaveCopyTitle: 'Als Kopie speichern?',
  uwConflictSaveCopyConfirm:
    'UniWork erstellt aus Ihrer Version ein neues Dokument mit demselben Eigentümer und denselben Zugriffsrechten wie dieses Dokument. Das aktuelle Dokument und Version {server} von {author} bleiben unverändert.',
  uwConflictSaveCopyGo: 'Kopie erstellen',
  uwConflictSaveCopyDone:
    'Ihre Version wurde als neues Dokument gespeichert: {title}. Dieses Dokument ist unverändert; Sie können weiterhin neu laden oder überschreiben.',
  uwConflictSaveCopyFailed:
    'Die Kopie konnte nicht erstellt werden. Ihre Änderungen sind weiterhin sicher; versuchen Sie es erneut.',
  uwConflictSaveCopyOffline:
    'Sie sind offline. Zum Erstellen einer Kopie ist eine Verbindung nötig; Ihre Änderungen bleiben erhalten.',
  uwConflictReloadFailed:
    'Die neueste Version konnte nicht geladen werden. Ihr Dokument ist unverändert; versuchen Sie es erneut.',
  uwConflictOverwriteFailed:
    'Überschreiben noch nicht möglich. Ihr Dokument ist unverändert; versuchen Sie es erneut.',
  uwConflictClose: 'Schließen',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Dieses Dokument wurde an anderer Stelle geändert',
  uwConflictBody: 'Ihre Änderungen sind noch nicht in UniWork und sicher auf diesem Computer.',
  uwConflictReload: 'Neueste Version laden',
  uwConflictOverwrite: 'Überschreiben…',
  uwConflictCancel: 'Abbrechen',
  uwConflictKeepUnavailable:
    'Dieser Computer kann gerade keinen Entwurf behalten (Synchronisierungsspeicher voll oder Schlüsselbund gesperrt).',
  uwConflictOfflineDesktop:
    'Sie sind offline und die neueste Version ist nicht auf diesem Computer, daher ist Neuladen noch nicht möglich.',
  uwConflictReloadDesktopBody:
    'Wählen Sie, was mit Ihren Änderungen geschieht, bevor Version {n} geladen wird.',
  uwConflictKeepDraft: 'Meine Version als Entwurf behalten',
  uwConflictDiscard: 'Meine Änderungen verwerfen',
  uwConflictKeepDraftHint:
    'Der Entwurf bleibt im Synchronisierungscenter zum Ansehen oder Kopieren; er wird nie automatisch auf die neue Version angewendet.',
  uwConflictDraftCapReached:
    'Dieses Dokument hat die maximale Anzahl behaltener Entwürfe erreicht: {cap}. Verwerfen Sie im Synchronisierungscenter einen alten Entwurf, um einen weiteren zu behalten.',

  // S6 new-version bar
  uwRemoteRegion: 'Neue Version',
  uwRemoteUpdated: 'Auf Version {n} aktualisiert, gespeichert von {author} um {time}.',
  uwRemoteUpdatedNoRev: 'Auf die neueste Version in UniWork aktualisiert.',
  uwRemoteNewerDirty:
    'In UniWork gibt es eine neuere Version (Version {n}). Sie haben ungespeicherte Änderungen, daher wurde das Dokument nicht neu geladen.',
  uwRemoteNewerAi:
    'In UniWork gibt es eine neuere Version (Version {n}). UniWork AI läuft, daher wurde das Dokument nicht neu geladen; KI-Ergebnisse gelten nur für die geöffnete Kopie.',
  uwRemoteNowClean:
    'Sie haben alle Änderungen rückgängig gemacht. Version {n} in UniWork ist neuer als die geöffnete Kopie.',
  uwRemoteStopAiConfirm:
    'Den laufenden UniWork-AI-Lauf stoppen, um neu zu laden? Bereits von der KI vorgenommene Änderungen gehören zur geöffneten Kopie.',
  uwRemoteWaitCommit:
    'Warten, bis das laufende Speichern abgeschlossen ist; danach können Sie neu laden.',
  uwRemoteReload: 'Neueste Version laden…',
  uwRemoteLater: 'Später',
  uwRemoteClose: 'Schließen',
  uwRemoteReloadFailed:
    'Version {n} konnte nicht geladen werden. Sie sehen weiterhin die vorherige Version.',
  uwRemoteDeleted:
    'Dieses Dokument wurde in UniWork gelöscht. Eingereihte Speicherstände wurden gestoppt.',
  uwAuthorFallback: 'ein Mitglied',

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'Das frühere Speichern benötigt Support, daher können Sie noch nicht neu laden oder überschreiben. Öffnen Sie das Synchronisierungscenter, um es zu lösen.',
  uwRemoteRevoked:
    'Sie haben keinen Zugriff mehr auf dieses Dokument. Das Speichern wurde gestoppt; ungespeicherte Änderungen bleiben gesperrt auf diesem Computer.',
} satisfies Record<keyof typeof zh, string>
