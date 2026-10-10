import type { zh } from './zh'

export const de = {
  webCancel: 'Abbrechen',
  webConflictTitle: 'Dieses Dokument wurde an anderer Stelle geändert',
  webConflictBody:
    'Während Sie bearbeitet haben, wurde eine neuere Version gespeichert. Mit Ihrer Version überschreiben oder die neueste Version neu laden und Ihre Änderungen verwerfen?',
  webConflictOverwrite: 'Überschreiben',
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
} satisfies Record<keyof typeof zh, string>
