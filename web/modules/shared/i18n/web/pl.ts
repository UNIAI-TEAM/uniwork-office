import type { zh } from './zh'

export const pl = {
  webCancel: 'Anuluj',
  webConflictTitle: 'Ten dokument został zmieniony w innym miejscu',
  webConflictBody:
    'Twoich zmian nie ma jeszcze w UniWork; są przechowywane w tej przeglądarce do czasu wylogowania.',
  webConflictOverwrite: 'Zastąp…',
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
  webDraftKept: 'Ta przeglądarka przechowuje kopię do czasu wylogowania.',
  webDraftRestore: 'Przywróć',
  webDraftDiscard: 'Odrzuć',
  webSaveNetwork: 'Nie można połączyć się z UniWork. Sprawdź połączenie i spróbuj ponownie.',
  webSaveTimeout: 'Zapisywanie trwało zbyt długo. Sprawdź połączenie i spróbuj ponownie.',
  webClose: 'Zamknij',
  webSaveUnauthorized: 'Sesja UniWork wygasła. Zaloguj się ponownie i spróbuj zapisać jeszcze raz.',
  webSaveForbidden: 'Nie masz uprawnień do zapisania tego dokumentu.',
  webSaveNotFound: 'Ten dokument już nie istnieje lub został przeniesiony.',
  webSaveTooLarge: 'Dokument jest zbyt duży, aby go zapisać.',
  webSaveRateLimited: 'Zbyt wiele żądań. Poczekaj chwilę i spróbuj ponownie.',
  webSaveServer: 'UniWork napotkał problem podczas zapisu. Spróbuj ponownie za chwilę.',
  webSaveFailedGeneric: 'Nie udało się zapisać dokumentu. Spróbuj ponownie.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Twoich zmian nie ma jeszcze w UniWork; są przechowywane w tej przeglądarce do czasu wylogowania.',
  uwConflictReloadWebBody:
    'Przeglądarka nie przechowuje szkiców konfliktu. Pobierz swoją wersję, aby później z niej skopiować, lub odrzuć zmiany.',
  uwConflictDownloadThenReload: 'Pobierz moją wersję, a potem wczytaj ponownie',
  uwConflictDiscardThenReload: 'Odrzuć zmiany i wczytaj ponownie',
  uwConflictMineFileSuffix: '(moja wersja)',
  uwConflictDownloadCheck:
    'Przeglądarka otrzymała plik. Sprawdź, czy został zapisany, a potem wybierz Wczytaj ponownie.',
  uwConflictSessionWeb:
    'Sesja wygasła, więc nie zastąpiono dokumentu. Zmiany pozostają w tej przeglądarce; zaloguj się ponownie i spróbuj jeszcze raz.',
  uwConflictTooLarge:
    'Twoja wersja przekracza limit rozmiaru UniWork, więc nie można było zastąpić.',
  uwConflictDownloadTooLarge:
    'Twoja wersja przekracza limit rozmiaru UniWork, więc nie można jej tutaj pobrać.',
  uwConflictDownloadFailed:
    'Nie udało się pobrać Twojej wersji, więc dokument nie został ponownie wczytany. Spróbuj ponownie.',
  uwConflictOfflineWeb:
    'Jesteś offline. W przeglądarce wymaga to połączenia; zmiany pozostają w tej przeglądarce.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Twoja wersja',
  uwConflictColServer: 'Wersja w UniWork',
  uwConflictRowVersion: 'Wersja',
  uwConflictRowTime: 'Czas',
  uwConflictRowBy: 'Zapisane przez',
  uwConflictMineUnsaved: 'Ty (niezapisane)',
  uwConflictBasedOn: 'na podstawie wersji {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Pokaż różnice',
  uwConflictDiffPending: 'Porównywanie…',
  uwConflictDiffFailed: 'Nie udało się teraz porównać wersji. Spróbuj ponownie później.',
  uwConflictNoEdit: 'Nie masz już uprawnień do edycji tego dokumentu.',
  uwConflictOverwriteTitle: 'Zastąpić Twoją wersją?',
  uwConflictOverwriteConfirm:
    'UniWork utworzy wersję {next} z Twojej kopii. Wersja {server} autorstwa {author} pozostanie w historii.',
  uwConflictOverwriteGo: 'Zastąp',
  uwConflictBack: 'Wstecz',
  uwConflictHeadMoved:
    'W międzyczasie w UniWork pojawiła się wersja {n}. Tabela została zaktualizowana; wybierz ponownie.',
  uwConflictReloadTitle: 'Wczytaj najnowszą',
  uwConflictReloadGo: 'Wczytaj ponownie',
  uwConflictSaveCopy: 'Zapisz jako kopię…',
  uwConflictSaveCopyName: '{name} (kopia)',
  uwConflictSaveCopyTitle: 'Zapisać jako kopię?',
  uwConflictSaveCopyConfirm:
    'UniWork utworzy nowy dokument z Twojej wersji, z tym samym właścicielem i dostępem co ten dokument. Bieżący dokument i wersja {server} autorstwa {author} pozostaną bez zmian.',
  uwConflictSaveCopyGo: 'Utwórz kopię',
  uwConflictSaveCopyDone:
    'Twoja wersja została zapisana jako nowy dokument: {title}. Ten dokument się nie zmienił; nadal możesz wczytać ponownie lub zastąpić.',
  uwConflictSaveCopyFailed:
    'Nie udało się utworzyć kopii. Zmiany są nadal bezpieczne; spróbuj ponownie.',
  uwConflictSaveCopyOffline:
    'Jesteś offline. Utworzenie kopii wymaga połączenia; zmiany zostają zachowane.',
  uwConflictReloadFailed:
    'Nie udało się wczytać najnowszej wersji. Dokument się nie zmienił; spróbuj ponownie.',
  uwConflictOverwriteFailed:
    'Nie udało się jeszcze zastąpić. Dokument się nie zmienił; spróbuj ponownie.',
  uwConflictClose: 'Zamknij',

  // S6 new-version bar
  uwRemoteRegion: 'Nowa wersja',
  uwRemoteUpdated: 'Zaktualizowano do wersji {n}, zapisanej przez {author} o {time}.',
  uwRemoteUpdatedNoRev: 'Zaktualizowano do najnowszej wersji w UniWork.',
  uwRemoteNewerDirty:
    'W UniWork jest nowsza wersja (wersja {n}). Masz niezapisane zmiany, więc dokument nie został ponownie wczytany.',
  uwRemoteNewerAi:
    'W UniWork jest nowsza wersja (wersja {n}). UniWork AI działa, więc dokument nie został ponownie wczytany; wyniki AI dotyczą tylko otwartej kopii.',
  uwRemoteNowClean:
    'Cofnięto wszystkie zmiany. Wersja {n} w UniWork jest nowsza niż otwarta kopia.',
  uwRemoteStopAiConfirm:
    'Zatrzymać działające UniWork AI, aby wczytać ponownie? Zmiany wprowadzone już przez AI należą do otwartej kopii.',
  uwRemoteWaitCommit: 'Czekanie na zakończenie trwającego zapisu; potem można wczytać ponownie.',
  uwRemoteReload: 'Wczytaj najnowszą…',
  uwRemoteLater: 'Później',
  uwRemoteClose: 'Zamknij',
  uwRemoteReloadFailed: 'Nie udało się wczytać wersji {n}. Nadal widzisz poprzednią wersję.',
  uwRemoteDeleted: 'Ten dokument został usunięty w UniWork. Zapisy w kolejce zostały zatrzymane.',
  uwAuthorFallback: 'członek zespołu',
  uwLockRegion: 'Stan dokumentu',
  uwActRetry: 'Spróbuj ponownie',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'Nie masz już dostępu do tego dokumentu. Zapisywanie zatrzymano; niezapisane zmiany są przechowywane w tej przeglądarce do czasu wylogowania.',
  uwRemoteOrgBlockedWeb:
    'Nie udało się zapisać: {reason}. Niezapisane zmiany są przechowywane w tej przeglądarce do czasu wylogowania.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'dokument zarchiwizowany',
  uwReasonSuspended: 'organizacja zawieszona',
  uwReasonDeactivated: 'Twoje konto jest dezaktywowane w tej organizacji',

  webSizeWarnChip: 'Zbliżanie się do limitu {max} (obecnie {size}).',
  webSaveBlockTitle: 'Nie udało się zapisać w UniWork',
  webSaveBlockBody:
    'Ten dokument przekracza {max}. Twoje zmiany nadal tu są. Pobierz swoją kopię na komputer, a następnie zmniejsz rozmiar obrazów lub podziel dokument.',
  webSaveBlockDownload: 'Pobierz moją kopię',
  uwConflictTooLargeWithLimit:
    'Twoja wersja przekracza {max} (obecnie {size}). Wybierz „Pobierz moją kopię” lub zamknij to okno, aby zmniejszyć rozmiar pliku.',
} satisfies Record<keyof typeof zh, string>
