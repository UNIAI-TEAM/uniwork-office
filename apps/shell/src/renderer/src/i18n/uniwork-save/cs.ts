import type { zh } from './zh'

export const cs = {
  usMyFolder: 'Moje složka',
  usPrivateTag: 'Soukromé',
  usDialogTitle: 'Pojmenujte dokument',
  usHint: 'První uložení. Další uložení si tento název ponechají; ke změně použijte „Uložit jako“.',
  usName: 'Název',
  usLocation: 'Umístění',
  usSavingIn: 'Ukládání do: {folder}',
  usMyFolderPrivate: 'Soukromé, vidíte jen vy',
  usChange: 'Změnit',
  usSave: 'Uložit',
  usClose: 'Zavřít',
  usPickTitle: 'Vyberte, kam uložit',
  usBack: 'Zpět k pojmenování',
  usSearchFolders: 'Hledat složky',
  usSharedNote: 'Při uložení do sdílené složky dostane dokument oprávnění této složky.',
  usChooseFolder: 'Vybrat „{folder}“',
  usSelected: 'Vybráno',
  usRootBlocked: 'Vyberte složku',
  usErrInvalidDestination: 'Sem nelze uložit. Vyberte jinou složku.',
  usErrMyFolderLocked:
    'Moje složka je vaše osobní systémová složka a nelze ji přejmenovat, sdílet, přesunout ani archivovat.',
  usErrFlushFailed:
    'Dokument se zatím nepodařilo zapsat do tohoto zařízení. Nejprve dokument uložte a pak to zkuste znovu.',
  usErrBindFailed:
    'Dokument „{title}“ (ID {id}) byl vytvořen, ale nepodařilo se ho propojit s touto kartou. Byl přesunut do koše a lze ho obnovit.',
  usErrOrphaned:
    'Dokument „{title}“ (ID {id}) byl vytvořen v UniWork, ale nepodařilo se ho propojit s touto kartou ani přesunout do koše. Odstraňte nebo použijte ho v UniWork.',
  usErrAlreadyBound: 'Tato karta je už propojena s dokumentem UniWork. Ukládejte jako obvykle.',
  usErrNotFound:
    'Soubor k uložení nebo vybranou složku nelze najít. Znovu vyberte, kam uložit, a zkuste to znovu.',
} satisfies Record<keyof typeof zh, string>
