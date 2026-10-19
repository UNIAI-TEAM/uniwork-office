import type { zh } from './zh'

export const de = {
  usMyFolder: 'Mein Ordner',
  usPrivateTag: 'Privat',
  usDialogTitle: 'Dokument benennen',
  usHint:
    'Erstes Speichern. Spätere Speicherungen behalten diesen Namen; zum Ändern „Speichern unter“ verwenden.',
  usName: 'Name',
  usLocation: 'Speicherort',
  usSavingIn: 'Speichern in: {folder}',
  usMyFolderPrivate: 'Privat, nur für Sie sichtbar',
  usChange: 'Ändern',
  usSave: 'Speichern',
  usClose: 'Schließen',
  usPickTitle: 'Speicherort wählen',
  usBack: 'Zurück zur Benennung',
  usSearchFolders: 'Ordner suchen',
  usChooseFolder: '„{folder}“ wählen',
  usSelected: 'Ausgewählt',
  usRootBlocked: 'Wählen Sie einen Ordner',
  usErrInvalidDestination: 'Hier kann nicht gespeichert werden. Wählen Sie einen anderen Ordner.',
  usErrMyFolderLocked:
    'Mein Ordner ist Ihr persönlicher Systemordner und kann nicht umbenannt, freigegeben, verschoben oder archiviert werden.',
  usErrFlushFailed:
    'Das Dokument konnte noch nicht auf diesem Gerät gespeichert werden. Speichern Sie das Dokument zuerst und versuchen Sie es dann erneut.',
  usErrBindFailed:
    '„{title}“ (ID {id}) wurde erstellt, konnte aber nicht mit diesem Tab verknüpft werden. Das Dokument liegt im Papierkorb und kann wiederhergestellt werden.',
  usErrOrphaned:
    '„{title}“ (ID {id}) wurde in UniWork erstellt, konnte aber weder mit diesem Tab verknüpft noch in den Papierkorb verschoben werden. Löschen oder verwenden Sie das Dokument in UniWork.',
  usErrAlreadyBound:
    'Dieser Tab ist bereits mit einem UniWork-Dokument verknüpft. Speichern Sie wie gewohnt.',
  usErrNotFound:
    'Die zu speichernde Datei oder der gewählte Ordner wurde nicht gefunden. Wählen Sie den Speicherort erneut und versuchen Sie es noch einmal.',
} satisfies Record<keyof typeof zh, string>
