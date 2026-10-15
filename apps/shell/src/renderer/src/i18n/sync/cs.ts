import type { zh } from './zh'

export const cs = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Uložení ve frontě — zatím není v UniWork',
  uwChipQueuedNewer: 'Uložení ve frontě · novější úpravy',
  uwChipPausedAdmin: 'Uložení ve frontě · odesílání pozastaveno',
  uwChipReconciling: 'Kontrola posledního uložení…',
  uwChipReconcileStuck: 'K potvrzení uložení je potřeba podpora',
  uwChipRemoteNewer: 'Novější verze v UniWork',
  uwTipQueued:
    'Uložení z {time} je bezpečně uchováno v tomto počítači a odešle se, až budete online.',
  uwTipQueuedNewer: 'Uložení z {time} čeká na odeslání. Pozdější úpravy do něj nepatří.',
  uwTipPausedAdmin: 'Správce pozastavil odesílání. Uložení zůstává v tomto počítači.',
  uwTipPausedUser:
    'Pozastavili jste odesílání. Uložení z {time} zůstává v tomto počítači; v centru synchronizace zvolte Obnovit odesílání.',
  uwTipReconciling:
    'Zatím není jasné, zda poslední uložení dorazilo do UniWork. Aplikace to ověřuje a nevytvoří duplikát.',
  uwTipRemoteNewer: 'Máte neuložené změny, proto se dokument znovu nenačetl.',
  uwTipFailed: 'Toto uložení se samo nezopakuje: {reason}. Vaše změny zůstávají v tomto počítači.',
  uwTipWaitAi: 'Čeká se, až AI dokončí aktuální krok, potom se uloží.',
  uwTipWaitAiLong: 'AI ještě nedokončila aktuální krok. Chcete-li uložit hned, zastavte běh AI.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Zobrazit frontu',
  uwActSaveAgain: 'Uložit znovu',
  uwActStopAi: 'Zastavit AI',
  uwActBack: 'Zpět',
  uwQueuePopWaiting: 'Čeká na uložení: z {time} (vychází z verze {base})',
  uwQueuePopNewer: 'Novější úpravy od té doby — neodesláno',
  uwQueueBlockedSave: 'Poslední uložení stále čeká. Znovu uložit můžete, až se dokončí.',
  uwQueueFull:
    'Úložiště synchronizace v tomto počítači je plné, proto se uložení nezařadilo do fronty. Vaše změny jsou stále v otevřeném okně; uvolněte místo v centru synchronizace.',
  uwQueueOpenCenter: 'Otevřít centrum synchronizace',
  uwQueueCancel: 'Zrušit uložení…',
  uwQueueCancelConfirm:
    'Zrušit uložení ve frontě? Změny zůstanou v tomto počítači; dokument v UniWork se nezmění.',
  uwQueueCancelGo: 'Zrušit uložení',
  uwQueueCancelled: 'Uložení ve frontě bylo zrušeno. Změny zůstávají v tomto počítači.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'přihlaste se znovu',
  uwReasonSignedOut: 'odhlášeno',
  uwReasonForeign: 'patří jinému účtu',
  uwReasonArchived: 'dokument archivován',
  uwReasonSuspended: 'organizace pozastavena',
  uwReasonDeactivated: 'váš účet je v této organizaci deaktivován',
  uwReasonLease: 'offline přístup vypršel',
  uwReasonKeystore: 'klíčenka tohoto počítače je zamčená',
  uwReasonClock: 'hodiny byly posunuty zpět',
  uwReasonStoreFull: 'úložiště synchronizace v tomto počítači je plné',
  uwReasonStoreNewer: 'je potřeba novější verze aplikace',

  // S2 queue-row badges
  uwBadgeQueued: 'Čeká',
  uwBadgeWaitNetwork: 'Čeká na síť',
  uwBadgePausedUser: 'Pozastaveno vámi',
  uwBadgePausedAdmin: 'Pozastaveno správcem',
  uwBadgeSending: 'Odesílání',
  uwBadgeReconciling: 'Ověřování',
  uwBadgeReconcileStuck: 'Vyžaduje podporu',
  uwBadgeConflict: 'Konflikt',
  uwBadgeBlocked: 'Blokováno',
  uwBadgeLocked: 'Zamčeno',
  uwBadgeRevoked: 'Bez přístupu',
  uwBadgeDeleted: 'Smazáno',
  uwBadgeReconnect: 'Je nutné znovu připojit',
  uwBadgeKeystore: 'Klíčenka zamčena',
  uwBadgeFailed: 'Nelze odeslat',
  uwBadgeSaved: 'Uloženo',
  uwBadgeKeptDraft: 'Uchovaný koncept',
  uwBadgeMoved: 'Přesunuto',
  uwBadgeArchived: 'Archivováno',

  // S2 queue-row details
  uwRowQueued: 'Uloženo {time} · vychází z verze {base} · {size}',
  uwRowWaitNetwork: 'Odešle se, až budete online',
  uwRowPausedUser: 'Odešle se, až zvolíte Obnovit odesílání',
  uwRowPausedAdmin: 'Odešle se, až správce znovu zapne odesílání',
  uwRowUploading: 'Nahrávání {done} / {total}',
  uwRowCommitting: 'Vytváření verze',
  uwRowReconciling: 'Výsledek odeslání z {time} zatím není jasný. Ověřuje se u UniWork.',
  uwRowReconcileStuck:
    'Pokusy o ověření: {count}, zatím bez výsledku. Aplikace znovu neodešle; pošlete kód podpory správci.',
  uwStuckDiscardConfirm:
    'Zahodit toto uložení? Pokud už dorazilo do UniWork, tato verze zůstane; vaše kopie se uchová jako koncept v centru synchronizace.',
  uwRowConflict: 'Verzi {n} uložil(a) {author} v {time}',
  uwRowFailed: 'Nelze odeslat: {reason}',
  uwRowBlocked: 'Nelze uložit: {reason}',
  uwRowCommitted: 'Verze {n} · {time}',
  uwRowKeptDraft: 'Uchováno při opětovném načtení v {time}',
  uwRowMoved: 'Dokument byl přesunut do {workspace}',
  uwRowArchived: 'Dokument byl v UniWork archivován',

  // S2 row actions
  uwActDiscard: 'Zahodit',
  uwActDiscardSave: 'Zahodit uložení…',
  uwActSendNow: 'Odeslat hned',
  uwActRecheck: 'Zkontrolovat znovu',
  uwActGuide: 'Průvodce',
  uwActOpenToResolve: 'Otevřít a vyřešit',
  uwActCopySupport: 'Kopírovat kód podpory',
  uwActDownloadMine: 'Stáhnout moji verzi',
  uwActOpenDraft: 'Otevřít koncept',
  uwActDiscardDraft: 'Zahodit koncept…',
  uwActSignInAgain: 'Znovu se přihlásit',
  uwActSignIn: 'Přihlásit se',
  uwActSwitchAccount: 'Přepnout účet',
  uwActReconnect: 'Znovu připojit',
  uwActDetails: 'Podrobnosti',
  uwActOpen: 'Otevřít',
  uwDiscardDraftConfirm:
    'Zahodit tento koncept? Jeho změny budou z tohoto počítače odstraněny a nepůjde je obnovit.',

  // Sign-out prompt
  uwSignOutTitle: 'Odhlásit se z UniWork?',
  uwSignOutBody:
    'Dokumenty s neuloženými změnami nebo uloženími ve frontě: {count}. Zůstanou v tomto počítači zamčené a znovu je otevře jen váš účet.',
  uwSignOutKeystore:
    'Klíčenka počítače je zamčená, takže neuložené změny existují jen v otevřených oknech. Odhlášením teď je zahodíte; co už je uchováno šifrovaně, zůstane. Chcete-li je zachovat, nejprve odemkněte počítač.',
  uwSignOutGo: 'Odhlásit se',
  uwSignOutWaiting: 'Dokončování probíhajícího uložení před odhlášením…',
  uwSignOutCaptureFailed:
    'Některé neuložené změny se nepodařilo včas zachytit; pro váš účet je ponechána poslední uložená nebo automaticky uložená verze.',
  uwSwitchLostTitle: 'Některé neuložené změny předchozího účtu byly ztraceny',
  uwSwitchLostBody:
    'Na tomto počítači se přihlásil jiný účet, takže předchozí účet byl uzamčen. Dokumenty, jejichž neuložené změny nešlo zachovat: {count}. Vše ostatní zůstává pro tento účet na tomto počítači uzamčeno.',
  uwSwitchLostOk: 'Rozumím',

  // S2 sync center
  uwSyncTitle: 'Centrum synchronizace',
  uwSyncOpenFromSettings: 'Centrum synchronizace',
  uwSyncOnline: 'Připojeno k UniWork · synchronizováno {time}',
  uwSyncOffline: 'Offline · naposledy synchronizováno {time}',
  uwSyncOnlineNoTime: 'Připojeno k UniWork',
  uwSyncOfflineNoTime: 'Offline',
  uwSyncPaused: 'Odesílání pozastaveno — nová uložení počkají',
  uwSyncAdminPaused: 'Správce pozastavil odesílání. Uložení zůstávají v tomto počítači.',
  uwSyncFeedOff:
    'Oznámení o nových verzích jsou pozastavena. UniWork při ukládání stále kontroluje konflikty.',
  uwSyncResynced: 'Plně znovu synchronizováno v {time}',
  uwSyncResyncFailed:
    'Ani po několika pokusech se nepodařilo znovu synchronizovat. Oznámení o nových verzích jsou pozastavena; UniWork při ukládání stále kontroluje konflikty.',
  uwSyncSignedOut: 'Jste odhlášeni. Položky uchované zamčené v tomto počítači: {count}.',
  uwSyncSignedOutEmpty: 'Jste odhlášeni.',
  uwSyncSessionExpired: 'Relace vypršela. Chcete-li dál odesílat, znovu se přihlaste.',
  uwSyncOtherOrg: 'Uložení čekající v jiné organizaci: {count}',
  uwSyncStoreBudget: 'Úložiště synchronizace v tomto počítači: {used} z {cap}',
  uwSyncStoreError: 'Frontu v tomto počítači nelze přečíst. Nic nebylo smazáno.',
  uwSyncNow: 'Synchronizovat hned',
  uwSyncPause: 'Pozastavit odesílání',
  uwSyncResume: 'Obnovit odesílání',
  uwSyncNowOffline: 'Synchronizace vyžaduje připojení.',
  uwSyncTabAttention: 'Vyžaduje pozornost',
  uwSyncTabQueue: 'Čeká na uložení',
  uwSyncTabOffline: 'Dostupné offline',
  uwSyncTabRecent: 'Nedávno uložené',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Dokument',
  uwSyncColState: 'Stav',
  uwSyncColDetail: 'Podrobnosti',
  uwSyncColActions: 'Akce',
  uwSyncMoreActions: 'Další akce pro {doc}',
  uwSyncEmptyQueue: 'Nic nečeká na uložení.',
  uwSyncEmptyAttention: 'Nic nevyžaduje pozornost.',
  uwSyncEmptyRecent: 'Žádná nedávná uložení.',
  uwSyncActionFailed: 'Nepodařilo se to. Nic nebylo smazáno; zkuste to znovu.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Zpřístupnit offline',
  uwOfflineUnpin: 'Odebrat offline kopii',
  uwOfflineUnpinShort: 'Odepnout',
  uwOfflineAdd: 'Přidat dokumenty…',
  uwOfflineUsage: 'Využito {used} z {cap} v tomto počítači',
  uwOfflineEmpty: 'Zatím nejsou offline dostupné žádné dokumenty.',
  uwOfflineCapReached:
    'Offline knihovna v tomto počítači dosáhla limitu: úložiště {cap}; maximální počet dokumentů: {maxDocs}. Chcete-li přidat další, odeberte některou offline kopii.',
  uwOfflineReady: 'Dostupné offline',
  uwOfflineBadgeWaiting: 'Čeká na síť',
  uwOfflineBadgeDownloading: 'Stahování',
  uwOfflineBadgeVerifying: 'Ověřování',
  uwOfflineBadgeUpdate: 'Je k dispozici aktualizace',
  uwOfflineBadgeInterrupted: 'Není připraveno',
  uwOfflineBadgeDiskFull: 'Nedostatek místa',
  uwOfflineBadgeCorrupt: 'Stažený soubor je poškozen',
  uwOfflineBadgeLeaseSoon: 'Offline přístup brzy skončí',
  uwOfflineBadgeViewOnly: 'Dostupné offline · jen zobrazení',
  uwOfflineRowWaiting: 'Stáhne se, až budete online',
  uwOfflineRowProgress: '{done} z {total}',
  uwOfflineRowProgressAria: '{done} z {total}',
  uwOfflineRowVerifying: 'Kontrola integrity',
  uwOfflineRowReady: 'Verze {n} · {size} · offline přístup do {datetime}',
  uwOfflineRowUpdate: 'Verze {n} se stáhne, až budete online; verze {old} stále funguje',
  uwOfflineRowUpdateKept:
    'Aktualizace na verzi {n} se nezdařila: {reason}. Verze {old} stále funguje.',
  uwOfflineRowInterrupted: 'Stahování bylo přerušeno. Starší kopie (pokud existuje) stále funguje.',
  uwOfflineRowDiskFull: 'Je potřeba ještě {size}. Starší kopie zůstává.',
  uwOfflineRowCorrupt: 'Poškozená kopie byla odstraněna. Stáhněte ji znovu.',
  uwOfflineRowLeaseSoon: 'Pro obnovení se připojte před {datetime}',
  uwOfflineRowRevoked:
    'K tomuto dokumentu už nemáte přístup. Stažená kopie byla odstraněna; koncepty zůstávají zamčené.',
  uwOfflineRowDeleted:
    'Dokument byl v UniWork smazán. Stažená kopie byla odstraněna; koncepty zůstávají zamčené.',
  uwOfflineRowArchived:
    'Dokument byl archivován; místní kopie se otevře, dokud offline přístup neskončí.',
  uwOfflineRowMoved: 'Přesunuto do {workspace}; místní kopie stále funguje.',
  uwOfflineRowViewOnly: 'Verze {n} · jen zobrazení · offline přístup do {datetime}',
  uwOfflineReadyAnnounce: 'Dostupné offline: {doc}',
  uwOfflineUnpinConfirm:
    'Stažená kopie bude z tohoto počítače odstraněna. Koncepty a uložení ve frontě zůstanou.',
  uwOfflineCancelDownload: 'Zrušit stahování',
  uwOfflineDownloadNow: 'Stáhnout hned',
  uwOfflineOpenFolder: 'Otevřít složku úložiště',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Je nutné znovu připojit',
  uwLockKeystoreTitle: 'Klíčenka tohoto počítače je zamčená',
  uwLockClockTitle: 'Je nutné ověřit čas',
  uwLockRevokedTitle: 'Bez přístupu',
  uwLockDeletedTitle: 'Dokument smazán',
  uwLockForeignTitle: 'Patří jinému účtu',
  uwLockOrgTitle: 'V této organizaci nelze otevřít',
  uwLockExpired:
    'Offline přístup vypršel. Obsah zůstává šifrovaný; pro opětovné otevření se připojte.',
  uwLockLibraryOff:
    'Správce vypnul offline dokumenty, takže offline přístup nelze obnovit. Koncepty zůstávají zamčené v centru synchronizace.',
  uwLockKeystore:
    'Klíčenka počítače je zamčená, takže šifrovaný obsah nelze otevřít. Odemkněte ji a zkuste to znovu; nic nebylo smazáno.',
  uwLockClock:
    'Hodiny počítače byly posunuty zpět, proto je offline přístup zamčený. Připojte se, aby UniWork mohl ověřit čas.',
  uwLockForeign:
    'Tento dokument patří jinému účtu v tomto počítači. Chcete-li ho otevřít, přepněte na tento účet.',
  uwLockSuspended: 'Organizace je pozastavena. Obsah zůstává šifrovaný; obraťte se na správce.',
  uwLockDeactivated:
    'Váš účet je v této organizaci deaktivován. Obsah zůstává šifrovaný; obraťte se na správce.',
  uwLockSignedOutTitle: 'Jste odhlášeni',
  uwLockSignedOut:
    'Obsah zůstává v tomto počítači zamčený. Pro opětovné otevření se přihlaste stejným účtem.',
  uwLockRegion: 'Stav dokumentu',
  uwLockWhileOpen:
    'Dokument byl zamčen, zatímco byl otevřený. Neuložené změny jsou uchovány šifrovaně; dokud se neodemkne, nemůžete ukládat ani kopírovat.',
  uwLockWhileOpenRam:
    'Dokument byl zamčen, zatímco byl otevřený, a tento počítač zatím nedokáže vaše změny bezpečně uchovat. Existují jen v tomto okně (jen zobrazení); jeho zavřením se ztratí.',
  uwLockOtherWindow:
    'Tento dokument je otevřený k úpravám v jiném okně. Toto okno je jen pro zobrazení.',
  uwLockOtherWindowGone:
    'Okno, ve kterém se tento dokument upravoval, přestalo reagovat. Můžete ho upravovat v tomto okně.',
  uwLockGoToWindow: 'Přejít do toho okna',
  uwLockTakeEdit: 'Upravovat v tomto okně',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Vaše verze',
  uwConflictColServer: 'Verze v UniWork',
  uwConflictRowVersion: 'Verze',
  uwConflictRowTime: 'Čas',
  uwConflictRowBy: 'Uložil(a)',
  uwConflictMineUnsaved: 'Vy (neuloženo)',
  uwConflictBasedOn: 'vychází z verze {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Zobrazit rozdíly',
  uwConflictNoEdit: 'K tomuto dokumentu už nemáte oprávnění k úpravám.',
  uwConflictOverwriteTitle: 'Přepsat vaší verzí?',
  uwConflictOverwriteConfirm:
    'UniWork vytvoří z vaší kopie verzi {next}. Verze {server} od {author} zůstane v historii.',
  uwConflictOverwriteGo: 'Přepsat',
  uwConflictBack: 'Zpět',
  uwConflictHeadMoved: 'Mezitím UniWork získal verzi {n}. Tabulka je aktualizovaná; vyberte znovu.',
  uwConflictReloadTitle: 'Načíst nejnovější',
  uwConflictReloadGo: 'Znovu načíst',
  uwConflictSaveCopy: 'Uložit jako kopii…',
  uwConflictSaveCopyTitle: 'Uložit jako kopii?',
  uwConflictSaveCopyConfirm:
    'UniWork vytvoří z vaší verze nový dokument se stejným vlastníkem a přístupem jako tento dokument. Aktuální dokument a verze {server} od {author} zůstanou beze změny.',
  uwConflictSaveCopyGo: 'Vytvořit kopii',
  uwConflictSaveCopyDone:
    'Vaše verze byla uložena jako nový dokument: {title}. Tento dokument se nezměnil; stále můžete znovu načíst nebo přepsat.',
  uwConflictSaveCopyFailed:
    'Kopii se nepodařilo vytvořit. Vaše změny jsou stále v bezpečí; zkuste to znovu.',
  uwConflictSaveCopyOffline:
    'Jste offline. Vytvoření kopie vyžaduje připojení; vaše změny zůstávají.',
  uwConflictReloadFailed:
    'Nejnovější verzi se nepodařilo načíst. Váš dokument se nezměnil; zkuste to znovu.',
  uwConflictOverwriteFailed:
    'Zatím se nepodařilo přepsat. Váš dokument se nezměnil; zkuste to znovu.',
  uwConflictClose: 'Zavřít',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Tento dokument byl změněn jinde',
  uwConflictBody: 'Vaše změny zatím nejsou v UniWork a jsou v bezpečí v tomto počítači.',
  uwConflictReload: 'Načíst nejnovější',
  uwConflictOverwrite: 'Přepsat…',
  uwConflictCancel: 'Zrušit',
  uwConflictKeepUnavailable:
    'Tento počítač teď nemůže uchovat koncept (úložiště synchronizace je plné nebo je klíčenka zamčená).',
  uwConflictOfflineDesktop:
    'Jste offline a nejnovější verze v tomto počítači není, takže ji zatím nelze znovu načíst.',
  uwConflictReloadDesktopBody: 'Před načtením verze {n} zvolte, co se stane s vašimi změnami.',
  uwConflictKeepDraft: 'Uchovat moji verzi jako koncept',
  uwConflictDiscard: 'Zahodit moje změny',
  uwConflictKeepDraftHint:
    'Koncept zůstane v centru synchronizace k zobrazení nebo zkopírování; na novou verzi se nikdy nepoužije automaticky.',
  uwConflictDraftCapReached:
    'Tento dokument dosáhl maximálního počtu uchovaných konceptů: {cap}. Chcete-li uchovat další, zahoďte starý koncept v centru synchronizace.',

  // S6 new-version bar
  uwRemoteRegion: 'Nová verze',
  uwRemoteUpdated: 'Aktualizováno na verzi {n}, kterou uložil(a) {author} v {time}.',
  uwRemoteUpdatedNoRev: 'Aktualizováno na nejnovější verzi v UniWork.',
  uwRemoteNewerDirty:
    'V UniWork je novější verze (verze {n}). Máte neuložené změny, proto se dokument znovu nenačetl.',
  uwRemoteNewerAi:
    'V UniWork je novější verze (verze {n}). Běží UniWork AI, proto se dokument znovu nenačetl; výsledky AI platí jen pro otevřenou kopii.',
  uwRemoteNowClean:
    'Vrátili jste všechny změny. Verze {n} v UniWork je novější než otevřená kopie.',
  uwRemoteStopAiConfirm:
    'Zastavit běžící UniWork AI a znovu načíst? Změny, které AI už provedla, patří k otevřené kopii.',
  uwRemoteWaitCommit: 'Čeká se na dokončení probíhajícího uložení; potom můžete znovu načíst.',
  uwRemoteReload: 'Načíst nejnovější…',
  uwRemoteLater: 'Později',
  uwRemoteClose: 'Zavřít',
  uwRemoteReloadFailed: 'Verzi {n} se nepodařilo načíst. Stále vidíte předchozí verzi.',
  uwRemoteDeleted: 'Tento dokument byl v UniWork smazán. Uložení ve frontě byla zastavena.',
  uwAuthorFallback: 'člen týmu',

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'Dřívější uložení vyžaduje podporu, proto zatím nemůžete znovu načíst ani přepsat. Otevřete centrum synchronizace a vyřešte to.',
  uwRemoteRevoked:
    'K tomuto dokumentu už nemáte přístup. Ukládání se zastavilo; neuložené změny zůstávají zamčené v tomto počítači.',
} satisfies Record<keyof typeof zh, string>
