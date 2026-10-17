import type { zh } from './zh'

export const de = {
  webConflictTitle: 'Diese Präsentation wurde an anderer Stelle geändert',
  webConflictBody:
    'Ihre Änderungen sind noch nicht in UniWork und bleiben in diesem Browser, bis Sie sich abmelden.',
  webConflictOverwrite: 'Überschreiben…',
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
  webRefusedTooLarge:
    'Diese Präsentation ist zu groß oder zu komplex, um im Web geöffnet zu werden.',
  webRefusedTooComplex:
    'Diese Präsentation ist zu komplex, um im Web geöffnet zu werden ({parts} Teile, Limit {limit}).',
  webRefusedOutOfMemory:
    'Diese Präsentation ist zu groß und beim Öffnen ist der Browser-Speicher erschöpft.',
  webNoHost: 'Dieser Editor läuft in UniWork. Öffnen Sie die Präsentation aus UniWork.',
  webLegacyPpt:
    'Dies ist eine ältere .ppt-Datei, die im Browser nicht geöffnet werden kann. Speichern Sie sie zuerst in PowerPoint als .pptx.',
  webEncryptedPptx:
    'Diese Präsentation ist kennwortgeschützt und kann im Browser nicht geöffnet werden.',
  webCommentAuthor: 'Benutzer',
  webExternalMedia: 'Verknüpfte externe Medien werden nur in der Desktop-App abgespielt.',
  webReadOnly: 'Diese Präsentation ist schreibgeschützt.',
  webSaveNetwork:
    'UniWork ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
  webSaveTimeout:
    'Das Speichern hat zu lange gedauert. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
  webFullscreenHint: 'Klicken oder eine beliebige Taste drücken, um den Vollbildmodus zu starten',
} satisfies Record<keyof typeof zh, string>
