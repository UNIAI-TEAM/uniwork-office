import type { zh } from './zh'

export const pl = {
  webConflictTitle: 'Ta prezentacja została zmieniona w innym miejscu',
  webConflictBody:
    'Ktoś zapisał nowszą wersję. Zastąp zastępuje ją Twoimi zmianami; Wczytaj najnowszą odrzuca Twoje zmiany i otwiera najnowszą wersję.',
  webConflictOverwrite: 'Zastąp',
  webConflictReload: 'Wczytaj najnowszą',
  webConflictNotSaved: 'prezentacja została zmieniona w innym miejscu',
  webDiscardTitle: 'Odrzucić niezapisane zmiany?',
  webDiscardBody:
    'Ta prezentacja ma niezapisane zmiany. Otwarcie innego pliku spowoduje ich utratę.',
  webDiscard: 'Odrzuć i otwórz',
  webCancel: 'Anuluj',
  webOk: 'OK',
  webFatalTitle: 'Nie można otworzyć prezentacji',
  webFatalBody: 'Nie udało się wczytać pliku z UniWork. Zamknij tę kartę i spróbuj ponownie.',
  webNoHost: 'Ten edytor działa w UniWork. Otwórz prezentację z UniWork.',
  webLegacyPpt:
    'To starszy plik .ppt i nie można go otworzyć w przeglądarce. Najpierw zapisz go jako .pptx w programie PowerPoint.',
  webEncryptedPptx: 'Ta prezentacja jest chroniona hasłem i nie można jej otworzyć w przeglądarce.',
  webCommentAuthor: 'Użytkownik',
  webExternalMedia: 'Połączone zewnętrzne multimedia są odtwarzane tylko w aplikacji klasycznej.',
  webReadOnly: 'Ta prezentacja jest tylko do odczytu.',
  webSaveNetwork: 'Nie można połączyć się z UniWork. Sprawdź połączenie i spróbuj ponownie.',
  webSaveTimeout: 'Zapisywanie trwało zbyt długo. Sprawdź połączenie i spróbuj ponownie.',
} satisfies Record<keyof typeof zh, string>
