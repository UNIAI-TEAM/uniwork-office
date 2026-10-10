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
  webReloaded: 'wczytano ponownie najnowszą wersję, a Twoje zmiany zostały odrzucone',
  webViewOnlyNoSave: 'ten dokument jest tylko do odczytu',
  webMergeTitle: 'Scal pliki PDF',
  webMergeBody: 'Wybrano pliki PDF: {count}. Dodać kolejny PDF czy scalić teraz?',
  webMergeAdd: 'Dodaj kolejny PDF',
  webMergeNow: 'Scal teraz',
  webSaveNetwork: 'Nie można połączyć się z UniWork. Sprawdź połączenie i spróbuj ponownie.',
  webSaveTimeout: 'Zapisywanie trwało zbyt długo. Sprawdź połączenie i spróbuj ponownie.',
} satisfies Record<keyof typeof zh, string>
