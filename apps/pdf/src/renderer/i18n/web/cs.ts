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
  webReloaded: 'byla znovu načtena nejnovější verze a vaše změny byly zahozeny',
  webViewOnlyNoSave: 'tento dokument je pouze pro čtení',
  webMergeTitle: 'Sloučit PDF',
  webMergeBody: 'Vybráno PDF: {count}. Přidat další PDF, nebo sloučit hned?',
  webMergeAdd: 'Přidat další PDF',
  webMergeNow: 'Sloučit hned',
  webSaveNetwork: 'K UniWork se nepodařilo připojit. Zkontrolujte připojení a zkuste to znovu.',
  webSaveTimeout: 'Ukládání trvalo příliš dlouho. Zkontrolujte připojení a zkuste to znovu.',
} satisfies Record<keyof typeof zh, string>
