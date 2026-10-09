import type { zh } from './zh'

export const de = {
  webConflictTitle: 'Diese Präsentation wurde an anderer Stelle geändert',
  webConflictBody:
    'Jemand hat eine neuere Version gespeichert. Überschreiben ersetzt sie durch Ihre Änderungen; Neueste laden verwirft Ihre Änderungen und öffnet die neueste Version.',
  webConflictOverwrite: 'Überschreiben',
  webConflictReload: 'Neueste laden',
  webConflictNotSaved: 'die Präsentation wurde an anderer Stelle geändert',
  webDiscardTitle: 'Nicht gespeicherte Änderungen verwerfen?',
  webDiscardBody:
    'Diese Präsentation enthält nicht gespeicherte Änderungen. Beim Öffnen einer anderen Datei gehen sie verloren.',
  webDiscard: 'Verwerfen und öffnen',
  webCancel: 'Abbrechen',
  webOk: 'OK',
  webFatalTitle: 'Die Präsentation konnte nicht geöffnet werden',
  webFatalBody:
    'Die Datei konnte nicht aus UniWork geladen werden. Schließen Sie diesen Tab und versuchen Sie es erneut.',
  webNoHost: 'Dieser Editor läuft in UniWork. Öffnen Sie die Präsentation aus UniWork.',
  webLegacyPpt:
    'Dies ist eine ältere .ppt-Datei, die im Browser nicht geöffnet werden kann. Speichern Sie sie zuerst in PowerPoint als .pptx.',
  webEncryptedPptx:
    'Diese Präsentation ist kennwortgeschützt und kann im Browser nicht geöffnet werden.',
  webCommentAuthor: 'Benutzer',
  webExternalMedia: 'Verknüpfte externe Medien werden nur in der Desktop-App abgespielt.',
  webReadOnly: 'Diese Präsentation ist schreibgeschützt.',
} satisfies Record<keyof typeof zh, string>
