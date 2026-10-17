import type { zh } from './zh'

export const de = {
  webCancel: 'Abbrechen',
  webConflictTitle: 'Dieses Dokument wurde an anderer Stelle geändert',
  webConflictBody:
    'Ihre Änderungen sind noch nicht in UniWork und bleiben in diesem Browser, bis Sie sich abmelden.',
  webConflictOverwrite: 'Überschreiben…',
  webConflictReload: 'Neueste Version laden',
  webConflictNotSaved: 'das Dokument wurde an anderer Stelle geändert',
  webFatalTitle: 'Das Dokument konnte nicht geöffnet werden',
  webFatalBody:
    'Bearbeiten und Speichern sind deaktiviert. Laden Sie die Seite neu oder öffnen Sie das Dokument erneut in UniWork.',
  webNoHost: 'Dieser Editor läuft in UniWork. Öffnen Sie das Dokument in UniWork.',
  webViewOnly: 'Nur Ansicht',
  webViewOnlyNotSaved: 'Dieses Dokument ist schreibgeschützt und kann nicht gespeichert werden',
  webNotUtf8:
    'Diese Datei ist kein UTF-8-Text. Sie wird schreibgeschützt geöffnet, damit Speichern ihre Bytes nicht verändert',
  webDraftTitle: 'Nicht gespeicherte Änderungen wiederherstellen?',
  webDraftBody:
    'Dieser Browser hat eine Kopie nicht gespeicherter Änderungen an diesem Dokument aufbewahrt. Wiederherstellen oder verwerfen?',
  webDraftOlder:
    'Die Kopie basiert auf einer älteren Version des Dokuments. Beim Speichern wird die neuere Version ersetzt.',
  webDraftSavedAt: 'Kopie gespeichert um',
  webDraftKept: 'Dieser Browser behält die Kopie, bis Sie sich abmelden.',
  webDraftRestore: 'Wiederherstellen',
  webDraftDiscard: 'Verwerfen',
  webSaveNetwork:
    'UniWork ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
  webSaveTimeout:
    'Das Speichern hat zu lange gedauert. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
  webClose: 'Schließen',
  webSaveUnauthorized:
    'Ihre UniWork-Sitzung ist abgelaufen. Melden Sie sich erneut an und speichern Sie noch einmal.',
  webSaveForbidden: 'Sie haben keine Berechtigung, dieses Dokument zu speichern.',
  webSaveNotFound: 'Dieses Dokument existiert nicht mehr oder wurde verschoben.',
  webSaveTooLarge: 'Das Dokument ist zu groß zum Speichern.',
  webSaveRateLimited: 'Zu viele Anfragen. Warten Sie einen Moment und versuchen Sie es erneut.',
  webSaveServer: 'UniWork hatte ein Problem beim Speichern. Versuchen Sie es gleich noch einmal.',
  webSaveFailedGeneric: 'Das Dokument konnte nicht gespeichert werden. Versuchen Sie es erneut.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Ihre Änderungen sind noch nicht in UniWork und bleiben in diesem Browser, bis Sie sich abmelden.',
  uwConflictReloadWebBody:
    'Der Browser behält keine Konfliktentwürfe. Laden Sie Ihre Version herunter, um später daraus zu kopieren, oder verwerfen Sie Ihre Änderungen.',
  uwConflictDownloadThenReload: 'Meine Version herunterladen, dann neu laden',
  uwConflictDiscardThenReload: 'Änderungen verwerfen und neu laden',
  uwConflictMineFileSuffix: '(meine Version)',
  uwConflictDownloadCheck:
    'Ihr Browser hat Ihre Datei erhalten. Prüfen Sie, ob sie gespeichert wurde, und wählen Sie dann „Neu laden“.',
  uwConflictSessionWeb:
    'Ihre Sitzung ist abgelaufen, daher wurde nicht überschrieben. Ihre Änderungen bleiben in diesem Browser; melden Sie sich erneut an und versuchen Sie es noch einmal.',
  uwConflictTooLarge:
    'Ihre Version überschreitet die Größenbeschränkung von UniWork und konnte daher nicht überschreiben.',
  uwConflictDownloadTooLarge:
    'Ihre Version überschreitet die Größenbeschränkung von UniWork und kann hier daher nicht heruntergeladen werden.',
  uwConflictDownloadFailed:
    'Ihre Version konnte nicht heruntergeladen werden, daher wurde das Dokument nicht neu geladen. Versuchen Sie es erneut.',
  uwConflictOfflineWeb:
    'Sie sind offline. Im Web ist dafür eine Verbindung nötig; Ihre Änderungen bleiben in diesem Browser.',

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
  uwConflictDiffPending: 'Vergleich läuft …',
  uwConflictDiffFailed:
    'Die Versionen konnten gerade nicht verglichen werden. Versuchen Sie es später erneut.',
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
  uwConflictSaveCopyName: '{name} (Kopie)',
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
  uwLockRegion: 'Dokumentstatus',
  uwActRetry: 'Erneut versuchen',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'Sie haben keinen Zugriff mehr auf dieses Dokument. Das Speichern wurde gestoppt; ungespeicherte Änderungen bleiben in diesem Browser, bis Sie sich abmelden.',
  uwRemoteOrgBlockedWeb:
    'Speichern fehlgeschlagen: {reason}. Ungespeicherte Änderungen bleiben in diesem Browser, bis Sie sich abmelden.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'Dokument archiviert',
  uwReasonSuspended: 'Organisation gesperrt',
  uwReasonDeactivated: 'Ihr Konto ist in dieser Organisation deaktiviert',

  webSizeWarnChip: 'Nähert sich dem Limit von {max} (aktuell {size}).',
  webSaveBlockTitle: 'Speichern in UniWork nicht möglich',
  webSaveBlockBody:
    'Dieses Dokument überschreitet {max}. Ihre Änderungen sind noch vorhanden. Laden Sie Ihre Kopie herunter und reduzieren Sie dann die Bildgrößen oder teilen Sie das Dokument auf.',
  webSaveBlockDownload: 'Meine Kopie herunterladen',
  uwConflictTooLargeWithLimit:
    'Ihre Version überschreitet {max} (aktuell {size}). Wählen Sie „Meine Kopie herunterladen“ oder schließen Sie diesen Dialog, um die Dateigröße zu verringern.',
  uwConflictSaveCopyTooLarge:
    'Ihre Version überschreitet die Größenbeschränkung von UniWork, daher konnte die Kopie nicht erstellt werden. Schließen Sie diesen Dialog, um die Dateigröße zu verringern, oder wählen Sie „Neueste Version laden“, um Ihre Version herunterzuladen.',
  uwConflictSaveCopyTooLargeWithLimit:
    'Ihre Version überschreitet {max} (aktuell {size}), daher konnte die Kopie nicht erstellt werden. Schließen Sie diesen Dialog, um die Dateigröße zu verringern, oder wählen Sie „Neueste Version laden“, um Ihre Version herunterzuladen.',
} satisfies Record<keyof typeof zh, string>
