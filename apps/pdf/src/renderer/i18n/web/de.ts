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
  webViewOnly: 'Nur ansehen',
  webReloaded: 'die neueste Version wurde neu geladen und Ihre Änderungen wurden verworfen',
  webViewOnlyNoSave: 'dieses Dokument ist schreibgeschützt',
  webMergeTitle: 'PDFs zusammenführen',
  webMergeBody: '{count} PDF(s) ausgewählt. Weitere PDF hinzufügen oder jetzt zusammenführen?',
  webMergeAdd: 'Weitere PDF hinzufügen',
  webMergeNow: 'Jetzt zusammenführen',
  webSaveNetwork:
    'UniWork ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
  webSaveTimeout:
    'Das Speichern hat zu lange gedauert. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
} satisfies Record<keyof typeof zh, string>
