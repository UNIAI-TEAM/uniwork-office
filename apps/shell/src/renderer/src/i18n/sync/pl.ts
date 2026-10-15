import type { zh } from './zh'

export const pl = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Zapis w kolejce — jeszcze nie w UniWork',
  uwChipQueuedNewer: 'Zapis w kolejce · nowsze zmiany',
  uwChipPausedAdmin: 'Zapis w kolejce · wysyłanie wstrzymane',
  uwChipReconciling: 'Sprawdzanie ostatniego zapisu…',
  uwChipReconcileStuck: 'Potrzebna pomoc, aby potwierdzić zapis',
  uwChipRemoteNewer: 'Nowsza wersja w UniWork',
  uwTipQueued:
    'Zapis z {time} jest bezpiecznie przechowywany na tym komputerze i zostanie wysłany, gdy będziesz online.',
  uwTipQueuedNewer: 'Zapis z {time} czeka na wysłanie. Późniejsze zmiany nie są jego częścią.',
  uwTipPausedAdmin: 'Administrator wstrzymał wysyłanie. Zapis pozostaje na tym komputerze.',
  uwTipPausedUser:
    'Wstrzymano wysyłanie. Zapis z {time} pozostaje na tym komputerze; wybierz Wznów wysyłanie w centrum synchronizacji.',
  uwTipReconciling:
    'Nie wiadomo jeszcze, czy ostatni zapis dotarł do UniWork. Aplikacja sprawdza to i nie utworzy duplikatu.',
  uwTipRemoteNewer: 'Masz niezapisane zmiany, więc dokument nie został ponownie wczytany.',
  uwTipFailed:
    'Ten zapis nie zostanie ponowiony automatycznie: {reason}. Zmiany pozostają na tym komputerze.',
  uwTipWaitAi: 'Czekanie, aż AI zakończy bieżący krok, potem zapis.',
  uwTipWaitAiLong: 'AI nie zakończyła bieżącego kroku. Zatrzymaj działanie AI, aby zapisać teraz.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Pokaż kolejkę',
  uwActSaveAgain: 'Zapisz ponownie',
  uwActStopAi: 'Zatrzymaj AI',
  uwActBack: 'Wstecz',
  uwQueuePopWaiting: 'Czeka na zapis: z {time} (na podstawie wersji {base})',
  uwQueuePopNewer: 'Nowsze zmiany od tego czasu — niewysłane',
  uwQueueBlockedSave: 'Ostatni zapis nadal czeka. Możesz zapisać ponownie, gdy się zakończy.',
  uwQueueFull:
    'Magazyn synchronizacji na tym komputerze jest pełny, więc zapis nie trafił do kolejki. Zmiany są nadal w otwartym oknie; zwolnij miejsce w centrum synchronizacji.',
  uwQueueOpenCenter: 'Otwórz centrum synchronizacji',
  uwQueueCancel: 'Anuluj zapis…',
  uwQueueCancelConfirm:
    'Anulować zapis w kolejce? Zmiany pozostają na tym komputerze; dokument w UniWork się nie zmieni.',
  uwQueueCancelled: 'Anulowano zapis w kolejce. Zmiany pozostają na tym komputerze.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'zaloguj się ponownie',
  uwReasonSignedOut: 'wylogowano',
  uwReasonForeign: 'należy do innego konta',
  uwReasonArchived: 'dokument zarchiwizowany',
  uwReasonSuspended: 'organizacja zawieszona',
  uwReasonDeactivated: 'Twoje konto jest dezaktywowane w tej organizacji',
  uwReasonLease: 'dostęp offline wygasł',
  uwReasonKeystore: 'pęk kluczy tego komputera jest zablokowany',
  uwReasonClock: 'zegar został cofnięty',
  uwReasonStoreFull: 'magazyn synchronizacji na tym komputerze jest pełny',
  uwReasonStoreNewer: 'potrzebna jest nowsza wersja aplikacji',

  // S2 queue-row badges
  uwBadgeQueued: 'Oczekuje',
  uwBadgeWaitNetwork: 'Czeka na sieć',
  uwBadgePausedUser: 'Wstrzymane przez Ciebie',
  uwBadgePausedAdmin: 'Wstrzymane przez administratora',
  uwBadgeSending: 'Wysyłanie',
  uwBadgeReconciling: 'Sprawdzanie',
  uwBadgeReconcileStuck: 'Wymaga pomocy',
  uwBadgeConflict: 'Konflikt',
  uwBadgeBlocked: 'Zablokowane',
  uwBadgeLocked: 'Zablokowany',
  uwBadgeRevoked: 'Brak dostępu',
  uwBadgeDeleted: 'Usunięty',
  uwBadgeReconnect: 'Wymaga ponownego połączenia',
  uwBadgeKeystore: 'Pęk kluczy zablokowany',
  uwBadgeFailed: 'Nie wysłano',
  uwBadgeSaved: 'Zapisano',
  uwBadgeKeptDraft: 'Zachowany szkic',
  uwBadgeMoved: 'Przeniesiony',
  uwBadgeArchived: 'Zarchiwizowany',

  // S2 queue-row details
  uwRowQueued: 'Zapisano {time} · na podstawie wersji {base} · {size}',
  uwRowWaitNetwork: 'Zostanie wysłany po połączeniu z siecią',
  uwRowPausedUser: 'Zostanie wysłany, gdy wybierzesz Wznów wysyłanie',
  uwRowPausedAdmin: 'Zostanie wysłany, gdy administrator ponownie włączy wysyłanie',
  uwRowUploading: 'Przesyłanie {done} / {total}',
  uwRowCommitting: 'Tworzenie wersji',
  uwRowReconciling: 'Wynik wysyłki z {time} nie jest jeszcze znany. Sprawdzanie w UniWork.',
  uwRowReconcileStuck:
    'Próby uzgodnienia: {count}, nadal brak wyniku. Aplikacja nie wyśle ponownie; prześlij kod pomocy administratorowi.',
  uwStuckDiscardConfirm:
    'Odrzucić ten zapis? Jeśli dotarł już do UniWork, ta wersja pozostanie; Twoja kopia zostanie zachowana jako szkic w centrum synchronizacji.',
  uwRowConflict: 'Wersję {n} zapisał(a) {author} o {time}',
  uwRowFailed: 'Nie wysłano: {reason}',
  uwRowBlocked: 'Nie można zapisać: {reason}',
  uwRowCommitted: 'Wersja {n} · {time}',
  uwRowKeptDraft: 'Zachowano przy ponownym wczytaniu o {time}',
  uwRowMoved: 'Dokument przeniesiono do {workspace}',
  uwRowArchived: 'Dokument zarchiwizowano w UniWork',

  // S2 row actions
  uwActDiscard: 'Odrzuć',
  uwActDiscardSave: 'Odrzuć zapis…',
  uwActSendNow: 'Wyślij teraz',
  uwActRecheck: 'Sprawdź ponownie',
  uwActGuide: 'Przewodnik',
  uwActOpenToResolve: 'Otwórz, aby rozwiązać',
  uwActCopySupport: 'Kopiuj kod pomocy',
  uwActDownloadMine: 'Pobierz moją wersję',
  uwActOpenDraft: 'Otwórz szkic',
  uwActDiscardDraft: 'Odrzuć szkic…',
  uwActSignInAgain: 'Zaloguj się ponownie',
  uwActSignIn: 'Zaloguj się',
  uwActSwitchAccount: 'Przełącz konto',
  uwActReconnect: 'Połącz ponownie',
  uwActDetails: 'Szczegóły',
  uwActOpen: 'Otwórz',
  uwDiscardDraftConfirm:
    'Odrzucić ten szkic? Jego zmiany zostaną usunięte z tego komputera i nie będzie można ich odzyskać.',

  // Sign-out prompt
  uwSignOutTitle: 'Wylogować się z UniWork?',
  uwSignOutBody:
    'Dokumenty z niezapisanymi zmianami lub zapisami w kolejce: {count}. Pozostaną zablokowane na tym komputerze i tylko Twoje konto będzie mogło je ponownie otworzyć.',
  uwSignOutKeystore:
    'Pęk kluczy komputera jest zablokowany, więc niezapisane zmiany istnieją tylko w otwartych oknach. Wylogowanie teraz je odrzuci; to, co już zachowano w postaci zaszyfrowanej, pozostanie. Aby je zachować, najpierw odblokuj komputer.',
  uwSignOutGo: 'Wyloguj się',
  uwSignOutWaiting: 'Kończenie trwającego zapisu przed wylogowaniem…',
  uwSignOutCaptureFailed:
    'Niektórych niezapisanych zmian nie udało się przechwycić na czas; dla Twojego konta zachowano najnowszą zapisaną lub automatycznie zapisaną wersję.',

  // S2 sync center
  uwSyncTitle: 'Centrum synchronizacji',
  uwSyncOpenFromSettings: 'Centrum synchronizacji',
  uwSyncOnline: 'Połączono z UniWork · zsynchronizowano {time}',
  uwSyncOffline: 'Offline · ostatnia synchronizacja {time}',
  uwSyncPaused: 'Wysyłanie wstrzymane — nowe zapisy poczekają',
  uwSyncAdminPaused: 'Administrator wstrzymał wysyłanie. Zapisy pozostają na tym komputerze.',
  uwSyncFeedOff:
    'Powiadomienia o nowych wersjach są wstrzymane. UniWork nadal sprawdza konflikty przy zapisie.',
  uwSyncResynced: 'W pełni ponownie zsynchronizowano o {time}',
  uwSyncResyncFailed:
    'Nie udało się ponownie zsynchronizować po kilku próbach. Powiadomienia o nowych wersjach są wstrzymane; UniWork nadal sprawdza konflikty przy zapisie.',
  uwSyncSignedOut:
    'Wylogowano. Elementy przechowywane w zablokowanej postaci na tym komputerze: {count}.',
  uwSyncSignedOutEmpty: 'Wylogowano.',
  uwSyncSessionExpired: 'Sesja wygasła. Zaloguj się ponownie, aby kontynuować wysyłanie.',
  uwSyncOtherOrg: 'Zapisy oczekujące w innej organizacji: {count}',
  uwSyncStoreBudget: 'Magazyn synchronizacji na tym komputerze: {used} z {cap}',
  uwSyncStoreError: 'Nie można odczytać kolejki na tym komputerze. Nic nie zostało usunięte.',
  uwSyncNow: 'Synchronizuj teraz',
  uwSyncPause: 'Wstrzymaj wysyłanie',
  uwSyncResume: 'Wznów wysyłanie',
  uwSyncNowOffline: 'Synchronizacja wymaga połączenia.',
  uwSyncTabAttention: 'Wymaga uwagi',
  uwSyncTabQueue: 'Czeka na zapis',
  uwSyncTabOffline: 'Dostępne offline',
  uwSyncTabRecent: 'Ostatnio zapisane',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Dokument',
  uwSyncColState: 'Stan',
  uwSyncColDetail: 'Szczegóły',
  uwSyncColActions: 'Działania',
  uwSyncMoreActions: 'Więcej działań dla {doc}',
  uwSyncEmptyQueue: 'Nic nie czeka na zapis.',
  uwSyncEmptyAttention: 'Nic nie wymaga uwagi.',
  uwSyncEmptyRecent: 'Brak ostatnich zapisów.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Udostępnij offline',
  uwOfflineUnpin: 'Usuń kopię offline',
  uwOfflineUnpinShort: 'Odepnij',
  uwOfflineAdd: 'Dodaj dokumenty…',
  uwOfflineUsage: 'Używane: {used} z {cap} na tym komputerze',
  uwOfflineEmpty: 'Żadne dokumenty nie są jeszcze dostępne offline.',
  uwOfflineCapReached:
    'Biblioteka offline na tym komputerze osiągnęła limit: miejsce {cap}; maksymalna liczba dokumentów: {maxDocs}. Usuń kopię offline, aby dodać kolejną.',
  uwOfflineReady: 'Dostępne offline',
  uwOfflineBadgeWaiting: 'Czeka na sieć',
  uwOfflineBadgeDownloading: 'Pobieranie',
  uwOfflineBadgeVerifying: 'Weryfikowanie',
  uwOfflineBadgeUpdate: 'Dostępna aktualizacja',
  uwOfflineBadgeInterrupted: 'Niegotowe',
  uwOfflineBadgeDiskFull: 'Za mało miejsca',
  uwOfflineBadgeCorrupt: 'Pobrany plik uszkodzony',
  uwOfflineBadgeLeaseSoon: 'Dostęp offline wkrótce wygaśnie',
  uwOfflineBadgeViewOnly: 'Dostępne offline · tylko do odczytu',
  uwOfflineRowWaiting: 'Zostanie pobrany po połączeniu z siecią',
  uwOfflineRowProgress: '{done} z {total}',
  uwOfflineRowProgressAria: '{done} z {total}',
  uwOfflineRowVerifying: 'Sprawdzanie integralności',
  uwOfflineRowReady: 'Wersja {n} · {size} · dostęp offline do {datetime}',
  uwOfflineRowUpdate:
    'Wersja {n} zostanie pobrana po połączeniu z siecią; wersja {old} nadal działa',
  uwOfflineRowUpdateKept:
    'Nie udało się zaktualizować do wersji {n}: {reason}. Wersja {old} nadal działa.',
  uwOfflineRowInterrupted:
    'Pobieranie zostało przerwane. Starsza kopia (jeśli istnieje) nadal działa.',
  uwOfflineRowDiskFull: 'Potrzeba jeszcze {size}. Starsza kopia zostaje zachowana.',
  uwOfflineRowCorrupt: 'Uszkodzona kopia została usunięta. Pobierz ją ponownie.',
  uwOfflineRowLeaseSoon: 'Połącz się przed {datetime}, aby odnowić',
  uwOfflineRowRevoked:
    'Nie masz już dostępu do tego dokumentu. Pobrana kopia została usunięta; szkice pozostają zablokowane.',
  uwOfflineRowDeleted:
    'Dokument został usunięty w UniWork. Pobrana kopia została usunięta; szkice pozostają zablokowane.',
  uwOfflineRowArchived:
    'Dokument został zarchiwizowany; tutejsza kopia otwiera się do końca dostępu offline.',
  uwOfflineRowMoved: 'Przeniesiono do {workspace}; tutejsza kopia nadal działa.',
  uwOfflineRowViewOnly: 'Wersja {n} · tylko do odczytu · dostęp offline do {datetime}',
  uwOfflineReadyAnnounce: 'Dostępne offline: {doc}',
  uwOfflineUnpinConfirm:
    'Pobrana kopia zostanie usunięta z tego komputera. Szkice i zapisy w kolejce zostaną zachowane.',
  uwOfflineCancelDownload: 'Anuluj pobieranie',
  uwOfflineDownloadNow: 'Pobierz teraz',
  uwOfflineOpenFolder: 'Otwórz folder magazynu',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Wymagane ponowne połączenie',
  uwLockKeystoreTitle: 'Pęk kluczy tego komputera jest zablokowany',
  uwLockClockTitle: 'Wymagane sprawdzenie czasu',
  uwLockRevokedTitle: 'Brak dostępu',
  uwLockDeletedTitle: 'Dokument usunięty',
  uwLockForeignTitle: 'Należy do innego konta',
  uwLockOrgTitle: 'Nie można otworzyć w tej organizacji',
  uwLockExpired:
    'Dostęp offline wygasł. Treść pozostaje zaszyfrowana; połącz się, aby otworzyć ją ponownie.',
  uwLockLibraryOff:
    'Administrator wyłączył dokumenty offline, więc nie można odnowić dostępu offline. Szkice pozostają zablokowane w centrum synchronizacji.',
  uwLockKeystore:
    'Pęk kluczy komputera jest zablokowany, więc nie można otworzyć zaszyfrowanej treści. Odblokuj go i spróbuj ponownie; nic nie zostało usunięte.',
  uwLockClock:
    'Zegar komputera został cofnięty, więc dostęp offline jest zablokowany. Połącz się, aby UniWork mógł sprawdzić czas.',
  uwLockForeign:
    'Ten dokument należy do innego konta na tym komputerze. Przełącz się na to konto, aby go otworzyć.',
  uwLockSuspended:
    'Organizacja jest zawieszona. Treść pozostaje zaszyfrowana; skontaktuj się z administratorem.',
  uwLockDeactivated:
    'Twoje konto jest dezaktywowane w tej organizacji. Treść pozostaje zaszyfrowana; skontaktuj się z administratorem.',
  uwLockSignedOutTitle: 'Wylogowano',
  uwLockSignedOut:
    'Treść pozostaje zablokowana na tym komputerze. Zaloguj się na to samo konto, aby otworzyć ją ponownie.',
  uwLockRegion: 'Stan dokumentu',
  uwLockWhileOpen:
    'Dokument został zablokowany, gdy był otwarty. Niezapisane zmiany są przechowywane w postaci zaszyfrowanej; do odblokowania nie można zapisywać ani kopiować.',
  uwLockWhileOpenRam:
    'Dokument został zablokowany, gdy był otwarty, a ten komputer nie może jeszcze bezpiecznie przechować zmian. Istnieją tylko w tym oknie (tylko do odczytu); zamknięcie go spowoduje ich utratę.',
  uwLockOtherWindow:
    'Ten dokument jest otwarty do edycji w innym oknie. To okno jest tylko do odczytu.',
  uwLockOtherWindowGone:
    'Okno, w którym edytowano ten dokument, przestało odpowiadać. Możesz edytować w tym oknie.',
  uwLockGoToWindow: 'Przejdź do tego okna',
  uwLockTakeEdit: 'Edytuj w tym oknie',

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

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Ten dokument został zmieniony w innym miejscu',
  uwConflictBody: 'Twoich zmian nie ma jeszcze w UniWork; są bezpieczne na tym komputerze.',
  uwConflictReload: 'Wczytaj najnowszą',
  uwConflictOverwrite: 'Zastąp…',
  uwConflictCancel: 'Anuluj',
  uwConflictKeepUnavailable:
    'Ten komputer nie może teraz zachować szkicu (magazyn synchronizacji pełny lub pęk kluczy zablokowany).',
  uwConflictOfflineDesktop:
    'Jesteś offline, a najnowszej wersji nie ma na tym komputerze, więc nie można jeszcze wczytać ponownie.',
  uwConflictReloadDesktopBody:
    'Wybierz, co stanie się z Twoimi zmianami przed wczytaniem wersji {n}.',
  uwConflictKeepDraft: 'Zachowaj moją wersję jako szkic',
  uwConflictDiscard: 'Odrzuć moje zmiany',
  uwConflictKeepDraftHint:
    'Szkic pozostaje w centrum synchronizacji do wglądu lub skopiowania; nigdy nie jest automatycznie stosowany do nowej wersji.',
  uwConflictDraftCapReached:
    'Ten dokument osiągnął maksymalną liczbę zachowanych szkiców: {cap}. Odrzuć stary szkic w centrum synchronizacji, aby zachować kolejny.',

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

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'Wcześniejszy zapis wymaga pomocy, więc nie można jeszcze wczytać ponownie ani zastąpić. Otwórz centrum synchronizacji, aby to rozwiązać.',
  uwRemoteRevoked:
    'Nie masz już dostępu do tego dokumentu. Zapisywanie zatrzymano; niezapisane zmiany pozostają zablokowane na tym komputerze.',
} satisfies Record<keyof typeof zh, string>
