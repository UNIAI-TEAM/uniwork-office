import type { zh } from './zh'

export const es = {
  usMyFolder: 'Mi carpeta',
  usPrivateTag: 'Privado',
  usDialogTitle: 'Poner nombre al documento',
  usHint:
    'Primer guardado. Los siguientes conservan este nombre; usa «Guardar como» para cambiarlo.',
  usName: 'Nombre',
  usLocation: 'Ubicación',
  usSavingIn: 'Guardando en: {folder}',
  usMyFolderPrivate: 'Privado, solo tú puedes verlo',
  usChange: 'Cambiar',
  usSave: 'Guardar',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: 'Cerrar',
  usPickTitle: 'Elegir dónde guardar',
  usBack: 'Volver al nombre',
  usSearchFolders: 'Buscar carpetas',
  usChooseFolder: 'Elegir «{folder}»',
  usSelected: 'Seleccionado',
  usRootBlocked: 'Elige una carpeta',
  usErrInvalidDestination: 'No se puede guardar aquí. Elige otra carpeta.',
  usErrMyFolderLocked:
    'Mi carpeta es tu carpeta personal del sistema y no se puede renombrar, compartir, mover ni archivar.',
  usErrFlushFailed:
    'Aún no se pudo escribir el documento en este dispositivo. Guarda primero el documento y vuelve a intentarlo.',
  usErrBindFailed:
    'Se creó «{title}» (ID {id}), pero no se pudo vincular a esta pestaña. El documento se movió a la papelera y se puede restaurar.',
  usErrOrphaned:
    'Se creó «{title}» (ID {id}) en UniWork, pero no se pudo vincular a esta pestaña ni mover a la papelera. Elimina o usa ese documento en UniWork.',
  usErrAlreadyBound:
    'Esta pestaña ya está vinculada a un documento de UniWork. Guarda como siempre.',
  usErrNotFound:
    'No se encuentra el archivo que se va a guardar o la carpeta elegida. Vuelve a elegir dónde guardar e inténtalo de nuevo.',
} satisfies Record<keyof typeof zh, string>
