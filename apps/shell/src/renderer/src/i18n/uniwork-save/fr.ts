import type { zh } from './zh'

export const fr = {
  usMyFolder: 'Mon dossier',
  usPrivateTag: 'Privé',
  usDialogTitle: 'Nommer le document',
  usHint:
    'Premier enregistrement. Les suivants conservent ce nom ; utilisez « Enregistrer sous » pour le changer.',
  usName: 'Nom',
  usLocation: 'Emplacement',
  usSavingIn: 'Enregistrement dans : {folder}',
  usMyFolderPrivate: 'Privé, visible par vous seul',
  usChange: 'Modifier',
  usSave: 'Enregistrer',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: 'Fermer',
  usPickTitle: 'Choisir l’emplacement',
  usBack: 'Revenir au nom',
  usSearchFolders: 'Rechercher un dossier',
  usChooseFolder: 'Choisir « {folder} »',
  usSelected: 'Sélectionné',
  usRootBlocked: 'Choisissez un dossier',
  usErrInvalidDestination: 'Impossible d’enregistrer ici. Choisissez un autre dossier.',
  usErrMyFolderLocked:
    'Mon dossier est votre dossier système personnel : il ne peut pas être renommé, partagé, déplacé ni archivé.',
  usErrFlushFailed:
    'Le document n’a pas encore pu être écrit sur cet appareil. Enregistrez d’abord le document, puis réessayez.',
  usErrBindFailed:
    '« {title} » (ID {id}) a été créé mais n’a pas pu être lié à cet onglet. Le document a été placé dans la corbeille et peut être restauré.',
  usErrOrphaned:
    '« {title} » (ID {id}) a été créé dans UniWork mais n’a pu être ni lié à cet onglet ni placé dans la corbeille. Supprimez ou utilisez ce document dans UniWork.',
  usErrAlreadyBound: 'Cet onglet est déjà lié à un document UniWork. Enregistrez comme d’habitude.',
  usErrNotFound:
    'Le fichier à enregistrer ou le dossier choisi est introuvable. Choisissez à nouveau l’emplacement, puis réessayez.',
} satisfies Record<keyof typeof zh, string>
