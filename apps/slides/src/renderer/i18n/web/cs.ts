import type { zh } from './zh'

export const cs = {
  webConflictTitle: 'Tato prezentace byla změněna jinde',
  webConflictBody:
    'Někdo uložil novější verzi. Přepsat ji nahradí vašimi změnami; Načíst nejnovější zahodí vaše změny a otevře nejnovější verzi.',
  webConflictOverwrite: 'Přepsat',
  webConflictReload: 'Načíst nejnovější',
  webConflictNotSaved: 'prezentace byla změněna jinde',
  webDiscardTitle: 'Zahodit neuložené změny?',
  webDiscardBody:
    'Tato prezentace obsahuje neuložené změny. Otevřením jiného souboru o ně přijdete.',
  webDiscard: 'Zahodit a otevřít',
  webCancel: 'Zrušit',
  webOk: 'OK',
  webFatalTitle: 'Prezentaci nelze otevřít',
  webFatalBody: 'Soubor se nepodařilo načíst z UniWork. Zavřete tuto kartu a zkuste to znovu.',
  webNoHost: 'Tento editor běží v UniWork. Otevřete prezentaci z UniWork.',
  webLegacyPpt:
    'Jde o starší soubor .ppt, který nelze otevřít v prohlížeči. Nejprve jej v PowerPointu uložte jako .pptx.',
  webEncryptedPptx: 'Tato prezentace je chráněna heslem a nelze ji otevřít v prohlížeči.',
  webCommentAuthor: 'Uživatel',
  webExternalMedia: 'Propojená externí média se přehrávají jen v desktopové aplikaci.',
  webReadOnly: 'Tato prezentace je jen pro čtení.',
  webSaveNetwork: 'K UniWork se nepodařilo připojit. Zkontrolujte připojení a zkuste to znovu.',
  webSaveTimeout: 'Ukládání trvalo příliš dlouho. Zkontrolujte připojení a zkuste to znovu.',
} satisfies Record<keyof typeof zh, string>
