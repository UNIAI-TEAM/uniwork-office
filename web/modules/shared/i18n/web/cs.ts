import type { zh } from './zh'

export const cs = {
  webCancel: 'Zrušit',
  webConflictTitle: 'Tento dokument byl změněn jinde',
  webConflictBody:
    'Během úprav byla uložena novější verze. Chcete ji přepsat svou verzí, nebo načíst nejnovější verzi a zahodit své změny?',
  webConflictOverwrite: 'Přepsat',
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
} satisfies Record<keyof typeof zh, string>
