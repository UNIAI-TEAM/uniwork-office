import type { zh } from './zh'

export const cs = {
  webCancel: 'Zrušit',
  webConflictTitle: 'Tento dokument byl změněn jinde',
  webConflictBody:
    'Vaše změny zatím nejsou v UniWork a zůstanou v tomto prohlížeči, dokud se neodhlásíte.',
  webConflictOverwrite: 'Přepsat…',
  webConflictReload: 'Načíst nejnovější verzi',
  webConflictNotSaved: 'dokument byl změněn jinde',
  webFatalTitle: 'Dokument nelze otevřít',
  webFatalBody:
    'Úpravy a ukládání jsou vypnuté. Obnovte stránku nebo dokument znovu otevřete z UniWork.',
  webNoHost: 'Tento editor běží v UniWork. Otevřete dokument z UniWork.',
  webViewOnly: 'Pouze pro čtení',
  webViewOnlyNotSaved: 'Tento dokument je pouze pro čtení a nelze jej uložit',
  webNotUtf8:
    'Tento soubor není text UTF-8. Otevře se pouze pro čtení, aby uložení nezměnilo jeho bajty',
  webDraftTitle: 'Obnovit neuložené změny?',
  webDraftBody:
    'Tento prohlížeč uchoval kopii neuložených změn tohoto dokumentu. Obnovit je, nebo zahodit?',
  webDraftOlder:
    'Kopie vychází ze starší verze dokumentu. Jejím uložením se nahradí novější verze.',
  webDraftSavedAt: 'Kopie uložena v',
  webDraftKept: 'Tento prohlížeč uchová kopii, dokud se neodhlásíte.',
  webDraftRestore: 'Obnovit',
  webDraftDiscard: 'Zahodit',
  webSaveNetwork: 'K UniWork se nepodařilo připojit. Zkontrolujte připojení a zkuste to znovu.',
  webSaveTimeout: 'Ukládání trvalo příliš dlouho. Zkontrolujte připojení a zkuste to znovu.',
  webClose: 'Zavřít',
  webSaveUnauthorized:
    'Vaše relace UniWork skončila. Přihlaste se znovu a zkuste uložení zopakovat.',
  webSaveForbidden: 'Nemáte oprávnění tento dokument uložit.',
  webSaveNotFound: 'Tento dokument už neexistuje nebo byl přesunut.',
  webSaveTooLarge: 'Dokument je příliš velký na uložení.',
  webSaveRateLimited: 'Příliš mnoho požadavků. Chvíli počkejte a zkuste to znovu.',
  webSaveServer: 'UniWork narazil při ukládání na potíž. Zkuste to za chvíli znovu.',
  webSaveFailedGeneric: 'Dokument se nepodařilo uložit. Zkuste to znovu.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Vaše změny zatím nejsou v UniWork a zůstanou v tomto prohlížeči, dokud se neodhlásíte.',
  uwConflictReloadWebBody:
    'Prohlížeč neuchovává koncepty konfliktů. Stáhněte svou verzi, abyste z ní mohli později kopírovat, nebo změny zahoďte.',
  uwConflictDownloadThenReload: 'Stáhnout moji verzi a potom znovu načíst',
  uwConflictDiscardThenReload: 'Zahodit změny a znovu načíst',
  uwConflictMineFileSuffix: '(moje verze)',
  uwConflictDownloadCheck:
    'Prohlížeč přijal váš soubor. Ověřte, že byl uložen, a pak zvolte Znovu načíst.',
  uwConflictSessionWeb:
    'Relace vypršela, proto k přepsání nedošlo. Změny zůstávají v tomto prohlížeči; znovu se přihlaste a zkuste to znovu.',
  uwConflictTooLarge: 'Vaše verze překračuje limit velikosti UniWork, proto ji nešlo přepsat.',
  uwConflictDownloadTooLarge:
    'Vaše verze překračuje limit velikosti UniWork, proto ji tady nelze stáhnout.',
  uwConflictDownloadFailed:
    'Vaši verzi se nepodařilo stáhnout, proto se dokument znovu nenačetl. Zkuste to znovu.',
  uwConflictOfflineWeb:
    'Jste offline. Na webu to vyžaduje připojení; vaše změny zůstávají v tomto prohlížeči.',

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
  uwConflictDiffPending: 'Porovnávání…',
  uwConflictDiffFailed: 'Verze se teď nepodařilo porovnat. Zkuste to znovu později.',
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
  uwConflictSaveCopyName: '{name} (kopie)',
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
  uwLockRegion: 'Stav dokumentu',
  uwActRetry: 'Zkusit znovu',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'K tomuto dokumentu už nemáte přístup. Ukládání se zastavilo; neuložené změny zůstanou v tomto prohlížeči, dokud se neodhlásíte.',
  uwRemoteOrgBlockedWeb:
    'Nelze uložit: {reason}. Neuložené změny zůstanou v tomto prohlížeči, dokud se neodhlásíte.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'dokument archivován',
  uwReasonSuspended: 'organizace pozastavena',
  uwReasonDeactivated: 'váš účet je v této organizaci deaktivován',

  webSizeWarnChip: 'Blíží se limitu {max} (aktuálně {size}).',
  webSaveBlockTitle: 'Nelze uložit do UniWork',
  webSaveBlockBody:
    'Tento dokument překračuje limit {max}. Vaše změny jsou stále zde. Stáhněte si kopii do počítače a poté zmenšete velikost obrázků nebo dokument rozdělte.',
  webSaveBlockDownload: 'Stáhnout moji kopii',
  uwConflictTooLargeWithLimit:
    'Vaše verze překračuje limit {max} (aktuálně {size}). Zavřete toto dialogové okno a zmenšete velikost souboru, nebo zvolte „Načíst nejnovější verzi“ a stáhněte si svou verzi.',
  uwConflictSaveCopyTooLarge:
    'Vaše verze překračuje limit velikosti UniWork, proto kopii nešlo vytvořit. Zavřete toto dialogové okno a zmenšete velikost souboru, nebo zvolte „Načíst nejnovější verzi“ a stáhněte si svou verzi.',
  uwConflictSaveCopyTooLargeWithLimit:
    'Vaše verze překračuje limit {max} (aktuálně {size}), proto kopii nešlo vytvořit. Zavřete toto dialogové okno a zmenšete velikost souboru, nebo zvolte „Načíst nejnovější verzi“ a stáhněte si svou verzi.',
} satisfies Record<keyof typeof zh, string>
