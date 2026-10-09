import type { zh } from './zh'

export const pl = {
  webCancel: 'Anuluj',
  webConflictTitle: 'Ten dokument został zmieniony w innym miejscu',
  webConflictBody:
    'Podczas edycji zapisano nowszą wersję. Czy zastąpić ją swoją wersją, czy wczytać najnowszą wersję i odrzucić swoje zmiany?',
  webConflictOverwrite: 'Zastąp',
  webConflictReload: 'Wczytaj najnowszą wersję',
  webConflictNotSaved: 'dokument został zmieniony w innym miejscu',
  webFatalTitle: 'Nie można otworzyć dokumentu',
  webFatalBody:
    'Edycja i zapisywanie są wyłączone. Odśwież stronę lub otwórz dokument ponownie z UniWork.',
  webNoHost: 'Ten edytor działa w UniWork. Otwórz dokument z UniWork.',
  webViewOnly: 'Tylko do odczytu',
  webViewOnlyNotSaved: 'Ten dokument jest tylko do odczytu i nie można go zapisać',
  webNotUtf8:
    'Ten plik nie jest tekstem UTF-8. Otwiera się tylko do odczytu, aby zapis nie zmienił jego bajtów',
  webDraftTitle: 'Przywrócić niezapisane zmiany?',
  webDraftBody:
    'Ta przeglądarka zachowała kopię niezapisanych zmian w tym dokumencie. Przywrócić je czy odrzucić?',
  webDraftOlder:
    'Kopia opiera się na starszej wersji dokumentu. Zapisanie jej zastąpi nowszą wersję.',
  webDraftSavedAt: 'Kopia zachowana o',
  webDraftRestore: 'Przywróć',
  webDraftDiscard: 'Odrzuć',
} satisfies Record<keyof typeof zh, string>
