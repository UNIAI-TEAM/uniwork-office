import type { zh } from './zh'

export const it = {
  usMyFolder: 'La mia cartella',
  usPrivateTag: 'Privato',
  usDialogTitle: 'Dai un nome al documento',
  usHint:
    'Primo salvataggio. I successivi mantengono questo nome; usa “Salva con nome” per cambiarlo.',
  usName: 'Nome',
  usLocation: 'Posizione',
  usSavingIn: 'Salvataggio in: {folder}',
  usMyFolderPrivate: 'Privato, visibile solo a te',
  usChange: 'Cambia',
  usSave: 'Salva',
  usClose: 'Chiudi',
  usPickTitle: 'Scegli dove salvare',
  usBack: 'Torna al nome',
  usSearchFolders: 'Cerca cartelle',
  usChooseFolder: 'Scegli “{folder}”',
  usSelected: 'Selezionato',
  usRootBlocked: 'Scegli una cartella',
  usErrInvalidDestination: 'Impossibile salvare qui. Scegli un’altra cartella.',
  usErrMyFolderLocked:
    'La mia cartella è la tua cartella personale di sistema e non può essere rinominata, condivisa, spostata o archiviata.',
  usErrFlushFailed:
    'Non è stato ancora possibile scrivere il documento su questo dispositivo. Salva prima il documento, poi riprova.',
  usErrBindFailed:
    '“{title}” (ID {id}) è stato creato ma non è stato possibile collegarlo a questa scheda. Il documento è stato spostato nel cestino e può essere ripristinato.',
  usErrOrphaned:
    '“{title}” (ID {id}) è stato creato in UniWork ma non è stato possibile collegarlo a questa scheda né spostarlo nel cestino. Elimina o usa quel documento in UniWork.',
  usErrAlreadyBound: 'Questa scheda è già collegata a un documento UniWork. Salva come al solito.',
  usErrNotFound:
    'Il file da salvare o la cartella scelta non è stato trovato. Scegli di nuovo dove salvare e riprova.',
} satisfies Record<keyof typeof zh, string>
