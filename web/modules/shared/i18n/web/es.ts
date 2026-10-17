import type { zh } from './zh'

export const es = {
  webCancel: 'Cancelar',
  webConflictTitle: 'Este documento se modificó en otro lugar',
  webConflictBody:
    'Tus cambios aún no están en UniWork y se conservan en este navegador hasta que cierres sesión.',
  webConflictOverwrite: 'Sobrescribir…',
  webConflictReload: 'Cargar la última versión',
  webConflictNotSaved: 'el documento se modificó en otro lugar',
  webFatalTitle: 'No se pudo abrir el documento',
  webFatalBody:
    'La edición y el guardado están desactivados. Recarga la página o vuelve a abrir el documento desde UniWork.',
  webNoHost: 'Este editor funciona dentro de UniWork. Abre el documento desde UniWork.',
  webViewOnly: 'Solo lectura',
  webViewOnlyNotSaved: 'Este documento es de solo lectura y no se puede guardar',
  webNotUtf8:
    'Este archivo no es texto UTF-8. Se abre en solo lectura para que guardar no cambie sus bytes',
  webDraftTitle: '¿Restaurar los cambios no guardados?',
  webDraftBody:
    'Este navegador conservó una copia de cambios no guardados de este documento. ¿Restaurarlos o descartarlos?',
  webDraftOlder:
    'La copia se basa en una versión anterior del documento. Al guardarla se reemplaza la versión más reciente.',
  webDraftSavedAt: 'Copia guardada a las',
  webDraftKept: 'Este navegador conserva la copia hasta que cierres sesión.',
  webDraftRestore: 'Restaurar',
  webDraftDiscard: 'Descartar',
  webSaveNetwork: 'No se pudo conectar con UniWork. Revisa tu conexión e inténtalo de nuevo.',
  webSaveTimeout: 'Guardar tardó demasiado. Revisa tu conexión e inténtalo de nuevo.',
  webClose: 'Cerrar',
  webSaveUnauthorized:
    'Tu sesión de UniWork ha terminado. Inicia sesión de nuevo e inténtalo otra vez.',
  webSaveForbidden: 'No tienes permiso para guardar este documento.',
  webSaveNotFound: 'Este documento ya no existe o se ha movido.',
  webSaveTooLarge: 'El documento es demasiado grande para guardarlo.',
  webSaveRateLimited: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
  webSaveServer: 'UniWork tuvo un problema al guardar. Inténtalo de nuevo en un momento.',
  webSaveFailedGeneric: 'No se pudo guardar el documento. Inténtalo de nuevo.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Tus cambios aún no están en UniWork y se conservan en este navegador hasta que cierres sesión.',
  uwConflictReloadWebBody:
    'El navegador no guarda borradores de conflicto. Descarga tu versión para copiar de ella más tarde o descarta tus cambios.',
  uwConflictDownloadThenReload: 'Descargar mi versión y luego recargar',
  uwConflictDiscardThenReload: 'Descartar cambios y recargar',
  uwConflictMineFileSuffix: '(mi versión)',
  uwConflictDownloadCheck:
    'Tu navegador recibió el archivo. Comprueba que se guardó y luego elige Recargar.',
  uwConflictSessionWeb:
    'Tu sesión caducó, así que no se sobrescribió. Tus cambios siguen en este navegador; vuelve a iniciar sesión e inténtalo de nuevo.',
  uwConflictTooLarge:
    'Tu versión supera el límite de tamaño de UniWork, así que no se pudo sobrescribir.',
  uwConflictDownloadTooLarge:
    'Tu versión supera el límite de tamaño de UniWork, así que no se puede descargar aquí.',
  uwConflictDownloadFailed:
    'No se pudo descargar tu versión, así que el documento no se recargó. Vuelve a intentarlo.',
  uwConflictOfflineWeb:
    'No tienes conexión. En la web esto requiere conexión; tus cambios siguen en este navegador.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Tu versión',
  uwConflictColServer: 'Versión en UniWork',
  uwConflictRowVersion: 'Versión',
  uwConflictRowTime: 'Hora',
  uwConflictRowBy: 'Guardado por',
  uwConflictMineUnsaved: 'Tú (sin guardar)',
  uwConflictBasedOn: 'basado en la versión {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Ver diferencias',
  uwConflictDiffPending: 'Comparando…',
  uwConflictDiffFailed:
    'No se pudieron comparar las versiones ahora. Inténtalo de nuevo más tarde.',
  uwConflictNoEdit: 'Ya no tienes permiso para editar este documento.',
  uwConflictOverwriteTitle: '¿Sobrescribir con tu versión?',
  uwConflictOverwriteConfirm:
    'UniWork creará la versión {next} a partir de tu copia. La versión {server} de {author} se mantiene en el historial.',
  uwConflictOverwriteGo: 'Sobrescribir',
  uwConflictBack: 'Atrás',
  uwConflictHeadMoved:
    'Mientras tanto, UniWork recibió la versión {n}. La tabla se ha actualizado; vuelve a elegir.',
  uwConflictReloadTitle: 'Recargar la última versión',
  uwConflictReloadGo: 'Recargar',
  uwConflictSaveCopy: 'Guardar como copia…',
  uwConflictSaveCopyName: '{name} (copia)',
  uwConflictSaveCopyTitle: '¿Guardar como copia?',
  uwConflictSaveCopyConfirm:
    'UniWork creará un documento nuevo a partir de tu versión, con el mismo propietario y acceso que este documento. El documento actual y la versión {server} de {author} no cambian.',
  uwConflictSaveCopyGo: 'Crear copia',
  uwConflictSaveCopyDone:
    'Tu versión se guardó como documento nuevo: {title}. Este documento no ha cambiado; aún puedes recargar o sobrescribir.',
  uwConflictSaveCopyFailed:
    'No se pudo crear la copia. Tus cambios siguen a salvo; vuelve a intentarlo.',
  uwConflictSaveCopyOffline:
    'No tienes conexión. Para crear una copia se necesita conexión; tus cambios se conservan.',
  uwConflictReloadFailed:
    'No se pudo cargar la última versión. Tu documento no ha cambiado; vuelve a intentarlo.',
  uwConflictOverwriteFailed:
    'Aún no se pudo sobrescribir. Tu documento no ha cambiado; vuelve a intentarlo.',
  uwConflictClose: 'Cerrar',

  // S6 new-version bar
  uwRemoteRegion: 'Nueva versión',
  uwRemoteUpdated: 'Actualizado a la versión {n}, guardada por {author} a las {time}.',
  uwRemoteUpdatedNoRev: 'Actualizado a la última versión en UniWork.',
  uwRemoteNewerDirty:
    'Hay una versión más reciente en UniWork (versión {n}). Tienes cambios sin guardar, así que el documento no se ha recargado.',
  uwRemoteNewerAi:
    'Hay una versión más reciente en UniWork (versión {n}). UniWork AI se está ejecutando, así que el documento no se ha recargado; los resultados de la IA solo se aplican a la copia abierta.',
  uwRemoteNowClean:
    'Has deshecho todos los cambios. La versión {n} en UniWork es más reciente que la copia abierta.',
  uwRemoteStopAiConfirm:
    '¿Detener la ejecución de UniWork AI para recargar? Los cambios que ya hizo la IA pertenecen a la copia abierta.',
  uwRemoteWaitCommit: 'Esperando a que termine el guardado en curso; después podrás recargar.',
  uwRemoteReload: 'Recargar la última versión…',
  uwRemoteLater: 'Más tarde',
  uwRemoteClose: 'Cerrar',
  uwRemoteReloadFailed: 'No se pudo cargar la versión {n}. Sigues viendo la versión anterior.',
  uwRemoteDeleted: 'Este documento se eliminó en UniWork. Los guardados en cola se detuvieron.',
  uwAuthorFallback: 'un miembro',
  uwLockRegion: 'Estado del documento',
  uwActRetry: 'Reintentar',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'Ya no tienes acceso a este documento. Se detuvo el guardado; los cambios sin guardar se conservan en este navegador hasta que cierres sesión.',
  uwRemoteOrgBlockedWeb:
    'No se pudo guardar: {reason}. Los cambios sin guardar se conservan en este navegador hasta que cierres sesión.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'documento archivado',
  uwReasonSuspended: 'organización suspendida',
  uwReasonDeactivated: 'tu cuenta está desactivada en esta organización',

  webSizeWarnChip: 'Acercándose al límite de {max} (actualmente {size}).',
  webSaveBlockTitle: 'No se pudo guardar en UniWork',
  webSaveBlockBody:
    'Este documento supera el límite de {max}. Tus cambios siguen aquí. Descarga tu copia en el ordenador y luego reduce el tamaño de las imágenes o divide el documento.',
  webSaveBlockDownload: 'Descargar mi copia',
  uwConflictTooLargeWithLimit:
    'Tu versión supera el límite de {max} (actualmente {size}). Elige «Descargar mi copia» o cierra este diálogo para reducir el tamaño del archivo.',
} satisfies Record<keyof typeof zh, string>
