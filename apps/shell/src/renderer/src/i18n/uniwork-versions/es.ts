import type { zh } from './zh'

export const es = {
  vhsMenuEntry: 'Historial de versiones',
  vhsTitle: 'Historial de versiones',
  vhsDescription:
    'Las versiones guardadas en el servidor. Restaurar escribe una versión nueva; el historial nunca se borra.',
  vhsLoading: 'Cargando historial…',
  vhsError: 'No se pudo cargar el historial de versiones.',
  vhsRetry: 'Reintentar',
  vhsEmpty: 'Aún no hay versiones. Crea la primera versión desde la copia de trabajo.',
  vhsLoadMore: 'Cargar más',
  vhsRowVersion: 'Versión {no}',
  vhsAuthorSystem: 'Sistema',
  vhsAuthorFormer: 'Antiguo miembro',
  vhsAuthorAgent: 'Agent',
  vhsCurrentBadge: 'Actual',
  vhsView: 'Ver contenido',
  vhsPreviewTitle: 'Contenido de la versión {no}',
  vhsPreviewError: 'No se pudo cargar el contenido de esta versión.',
  vhsPreviewEmpty: 'Esta versión no tiene contenido.',
  vhsOpenUnsupported: 'Esta versión no se puede abrir en la aplicación. Descárgala en su lugar.',
  vhsDownload: 'Descargar esta versión',
  vhsDownloadVersion: 'Descargar la versión {no}',
  vhsDownloadFailed: 'No se pudo descargar el archivo',
  vhsNameLabel: 'Nombre de la versión',
  vhsNamePlaceholder: 'p. ej. Antes de los cambios de la revisión',
  vhsNameHint: 'La versión guarda la copia de trabajo; el nombre es opcional.',
  vhsNameSubmit: 'Crear versión',
  vhsNameSubmitting: 'Creando…',
  vhsNameDone: 'Versión {no} creada',
  vhsNameFailed: 'No se pudo crear la versión. Lo que escribiste se conserva.',
  vhsNameUnchanged:
    'No ha cambiado nada desde la última versión, así que no se creó una versión nueva.',
  vhsRestore: 'Restaurar la versión {no}',
  vhsRestoreConfirmTitle: '¿Restaurar la versión {no}?',
  vhsRestoreConfirmDescription:
    'La copia de trabajo toma el contenido de esta versión y se añade una nueva versión de restauración. El historial se mantiene.',
  vhsRestoreConfirmSubmit: 'Restaurar',
  vhsRestoreSubmitting: 'Restaurando…',
  vhsRestoreFailed: 'No se pudo restaurar. La copia de trabajo no ha cambiado.',
  vhsRestoreConflict:
    'La copia de trabajo acaba de cambiar. Vuelve a abrir el historial e inténtalo de nuevo.',
  vhsManageOnly: 'Necesitas acceso de edición para restaurar una versión.',
  vhsShelvedBlocked: 'Este documento está archivado y es de solo lectura.',
  vhsLockedByOther:
    'Otra persona está editando este documento. Espera a que termine o toma el control de la edición e inténtalo de nuevo.',
  vhsLockedByMe:
    'Estás editando este documento en otra ventana. Guárdalo o ciérralo allí e inténtalo de nuevo.',
  vhsReasonUpload: 'subida',
  vhsReasonManual: 'manual',
  vhsReasonAuto: 'automática',
  vhsReasonRestore: 'restauración',
  vhsReasonAgent: 'agent',
  vhsReasonUnknown: 'otra',
  vhsCoalescedGroupOne: '{n} guardado en esta sesión',
  vhsCoalescedGroupOther: '{n} guardados en esta sesión',
  vhsCoalescedOrphanOne: '{n} guardado se fusionó en la última versión de su sesión de edición',
  vhsCoalescedOrphanOther:
    '{n} guardados se fusionaron en la última versión de su sesión de edición',
  vhsReleasedNoContent: 'Esta versión ya no tiene contenido que abrir o descargar.',
  vhsErrVersionCoalesced:
    'Esta versión se fusionó en la última versión de su sesión de edición, por lo que no tiene contenido propio. Abre esa última versión en su lugar.',
  vhsErrFileChunkMissing:
    'No se pudo leer este archivo porque falta una parte de sus datos almacenados. Inténtalo de nuevo en unos minutos; si sigue fallando, avisa a un administrador.',
  vhsClose: 'Cerrar',
  vhsCancel: 'Cancelar',
} satisfies Record<keyof typeof zh, string>
