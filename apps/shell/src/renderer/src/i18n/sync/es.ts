import type { zh } from './zh'

export const es = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Guardado en cola: aún no está en UniWork',
  uwChipQueuedNewer: 'Guardado en cola · cambios más recientes',
  uwChipPausedAdmin: 'Guardado en cola · envío en pausa',
  uwChipReconciling: 'Comprobando el último guardado…',
  uwChipReconcileStuck: 'Se necesita soporte para confirmar el guardado',
  uwErrReconcileStuck: 'Se necesita soporte para confirmar el guardado.',
  uwChipRemoteNewer: 'Versión más reciente en UniWork',
  uwTipQueued:
    'Tu guardado de las {time} se conserva de forma segura en este equipo y se enviará cuando sea posible.',
  uwTipQueuedNewer:
    'El guardado de las {time} está esperando para enviarse. Los cambios posteriores no forman parte de él.',
  uwTipPausedAdmin: 'Tu administrador ha pausado el envío. El guardado se conserva en este equipo.',
  uwTipPausedUser:
    'Has pausado el envío. El guardado de las {time} se conserva en este equipo; elige Reanudar envío en el centro de sincronización.',
  uwTipReconciling:
    'Aún no está claro si el último guardado llegó a UniWork. La aplicación lo está comprobando y no creará un duplicado.',
  uwTipRemoteNewer: 'Tienes cambios sin guardar, así que el documento no se ha recargado.',
  uwTipFailed: 'Este guardado no se reintentará solo: {reason}. Tus cambios siguen en este equipo.',
  uwTipWaitAi: 'Esperando a que la IA termine el paso actual para guardar.',
  uwTipWaitAiLong:
    'La IA no ha terminado el paso actual. Detén la ejecución de la IA para guardar ahora.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Ver cola',
  uwActSaveAgain: 'Guardar de nuevo',
  uwActStopAi: 'Detener IA',
  uwActBack: 'Atrás',
  uwQueuePopWaiting: 'Pendiente de guardar: de las {time} (basado en la versión {base})',
  uwQueuePopNewer: 'Cambios más recientes desde entonces: sin enviar',
  uwQueueBlockedSave: 'Tu último guardado sigue pendiente. Podrás guardar de nuevo cuando termine.',
  uwQueueFull:
    'El almacenamiento de sincronización de este equipo está lleno, así que el guardado no se puso en cola. Tus cambios siguen en la ventana abierta; libera espacio en el centro de sincronización.',
  uwQueueOpenCenter: 'Abrir centro de sincronización',
  uwQueueCancel: 'Cancelar guardado…',
  uwQueueCancelConfirm:
    '¿Cancelar el guardado en cola? Tus cambios siguen en este equipo; el documento en UniWork no cambia.',
  uwQueueCancelGo: 'Cancelar guardado',
  uwQueueCancelled: 'Guardado en cola cancelado. Tus cambios siguen en este equipo.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'vuelve a iniciar sesión',
  uwReasonSignedOut: 'sesión cerrada',
  uwReasonForeign: 'pertenece a otra cuenta',
  uwReasonArchived: 'documento archivado',
  uwReasonSuspended: 'organización suspendida',
  uwReasonDeactivated: 'tu cuenta está desactivada en esta organización',
  uwReasonLease: 'acceso sin conexión caducado',
  uwReasonKeystore: 'el llavero de este equipo está bloqueado',
  uwReasonClock: 'el reloj se atrasó',
  uwReasonStoreFull: 'el almacenamiento de sincronización de este equipo está lleno',
  uwReasonStoreNewer: 'se necesita una versión más reciente de la aplicación',

  // S2 queue-row badges
  uwBadgeQueued: 'En espera',
  uwBadgeWaitNetwork: 'Esperando red',
  uwBadgePausedUser: 'Pausado por ti',
  uwBadgePausedAdmin: 'Pausado por el administrador',
  uwBadgeSending: 'Enviando',
  uwBadgeReconciling: 'Comprobando',
  uwBadgeReconcileStuck: 'Necesita soporte',
  uwBadgeConflict: 'Conflicto',
  uwBadgeBlocked: 'Bloqueado',
  uwBadgeLocked: 'Bloqueado',
  uwBadgeRevoked: 'Sin acceso',
  uwBadgeDeleted: 'Eliminado',
  uwBadgeReconnect: 'Hay que reconectar',
  uwBadgeKeystore: 'Llavero bloqueado',
  uwBadgeFailed: 'No se pudo enviar',
  uwBadgeSaved: 'Guardado',
  uwBadgeKeptDraft: 'Borrador guardado',
  uwBadgeMoved: 'Movido',
  uwBadgeArchived: 'Archivado',

  // S2 queue-row details
  uwRowQueued: 'Guardado {time} · basado en la versión {base} · {size}',
  uwRowWaitNetwork: 'Se enviará cuando haya conexión',
  uwRowPausedUser: 'Se enviará cuando elijas Reanudar envío',
  uwRowPausedAdmin: 'Se enviará cuando tu administrador vuelva a activar el envío',
  uwRowUploading: 'Subiendo {done} / {total}',
  uwRowCommitting: 'Creando la versión',
  uwRowReconciling:
    'Aún no está claro el resultado del envío de las {time}. Comprobando con UniWork.',
  uwRowReconcileStuck:
    'Intentos de comprobación: {count}, aún sin resultado. La aplicación no volverá a enviar; envía el código de soporte a tu administrador.',
  uwStuckDiscardConfirm:
    '¿Descartar este guardado? Si ya llegó a UniWork, esa versión se mantiene; tu copia se guarda como borrador en el centro de sincronización.',
  uwRowConflict: 'La versión {n} la guardó {author} a las {time}',
  uwRowFailed: 'No se pudo enviar: {reason}',
  uwRowBlocked: 'No se puede guardar: {reason}',
  uwRowCommitted: 'Versión {n} · {time}',
  uwRowKeptDraft: 'Guardado al recargar a las {time}',
  uwRowMoved: 'El documento se movió a {workspace}',
  uwRowArchived: 'El documento se archivó en UniWork',

  // S2 row actions
  uwActDiscard: 'Descartar',
  uwActDiscardSave: 'Descartar guardado…',
  uwActSendNow: 'Enviar ahora',
  uwActRecheck: 'Comprobar de nuevo',
  uwActGuide: 'Guía',
  uwActOpenToResolve: 'Abrir para resolver',
  uwActCopySupport: 'Copiar código de soporte',
  uwActDownloadMine: 'Descargar mi versión',
  uwActOpenDraft: 'Abrir borrador',
  uwActDiscardDraft: 'Descartar borrador…',
  uwActSignInAgain: 'Volver a iniciar sesión',
  uwActSignIn: 'Iniciar sesión',
  uwActSwitchAccount: 'Cambiar de cuenta',
  uwActReconnect: 'Reconectar',
  uwActDetails: 'Detalles',
  uwActOpen: 'Abrir',
  uwDiscardDraftConfirm:
    '¿Descartar este borrador? Sus cambios se eliminarán de este equipo y no se podrán recuperar.',

  // Sign-out prompt
  uwSignOutTitle: '¿Cerrar sesión en UniWork?',
  uwSignOutBody:
    'Documentos con cambios sin guardar o guardados en cola: {count}. Se quedan bloqueados en este equipo y solo tu cuenta podrá volver a abrirlos.',
  uwSignOutKeystore:
    'El llavero del equipo está bloqueado, así que los cambios sin guardar solo existen en las ventanas abiertas. Si cierras sesión ahora, se descartarán; lo que ya se guardó cifrado se mantiene. Para conservarlos, desbloquea primero el equipo.',
  uwSignOutGo: 'Cerrar sesión',
  uwSignOutWaiting: 'Terminando el guardado en curso antes de cerrar sesión…',
  uwSignOutCaptureFailed:
    'Algunos cambios sin guardar no pudieron capturarse a tiempo; se conserva la versión guardada o guardada automáticamente más reciente para tu cuenta.',
  uwSwitchLostTitle: 'Se perdieron algunos cambios sin guardar de la cuenta anterior',
  uwSwitchLostBody:
    'Otra cuenta inició sesión en este equipo, así que la cuenta anterior se bloqueó. Documentos cuyos cambios sin guardar no se pudieron conservar: {count}. Todo lo demás sigue bloqueado en este equipo para esa cuenta.',
  uwSwitchLostOk: 'Entendido',

  // S2 sync center
  uwSyncTitle: 'Centro de sincronización',
  uwSyncOpenFromSettings: 'Centro de sincronización',
  uwSyncOnline: 'Conectado a UniWork · sincronizado {time}',
  uwSyncOffline: 'Sin conexión · última sincronización {time}',
  uwSyncOnlineNoTime: 'Conectado a UniWork',
  uwSyncOfflineNoTime: 'Sin conexión',
  uwSyncPaused: 'Envío en pausa: los nuevos guardados esperarán',
  uwSyncAdminPaused:
    'Tu administrador ha pausado el envío. Los guardados se conservan en este equipo.',
  uwSyncFeedOff:
    'Los avisos de nuevas versiones están en pausa. UniWork sigue comprobando conflictos al guardar.',
  uwSyncResynced: 'Resincronizado por completo a las {time}',
  uwSyncResyncFailed:
    'No se pudo resincronizar tras varios intentos. Los avisos de nuevas versiones están en pausa; UniWork sigue comprobando conflictos al guardar.',
  uwSyncSignedOut: 'Has cerrado sesión. Elementos guardados bloqueados en este equipo: {count}.',
  uwSyncSignedOutEmpty: 'Has cerrado sesión.',
  uwSyncSessionExpired: 'Tu sesión ha caducado. Vuelve a iniciar sesión para seguir enviando.',
  uwSyncOtherOrg: 'Guardados pendientes en otra organización: {count}',
  uwSyncStoreBudget: 'Almacenamiento de sincronización en este equipo: {used} de {cap}',
  uwSyncStoreError: 'No se pudo leer la cola de este equipo. No se ha eliminado nada.',
  uwSyncNow: 'Sincronizar ahora',
  uwSyncPause: 'Pausar envío',
  uwSyncResume: 'Reanudar envío',
  uwSyncNowOffline: 'Para sincronizar se necesita conexión.',
  uwSyncTabAttention: 'Requiere atención',
  uwSyncTabQueue: 'Pendiente de guardar',
  uwSyncTabOffline: 'Disponible sin conexión',
  uwSyncTabRecent: 'Guardados recientemente',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Documento',
  uwSyncColState: 'Estado',
  uwSyncColDetail: 'Detalles',
  uwSyncColActions: 'Acciones',
  uwSyncMoreActions: 'Más acciones para {doc}',
  uwSyncEmptyQueue: 'No hay nada pendiente de guardar.',
  uwSyncEmptyAttention: 'Nada requiere atención.',
  uwSyncEmptyRecent: 'No hay guardados recientes.',
  uwSyncActionFailed: 'No se pudo completar. No se eliminó nada; inténtalo de nuevo.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Hacer disponible sin conexión',
  uwOfflineUnpin: 'Quitar copia sin conexión',
  uwOfflineUnpinShort: 'Desanclar',
  uwOfflineAdd: 'Añadir documentos…',
  uwOfflineUsage: 'Usando {used} de {cap} en este equipo',
  uwOfflineEmpty: 'Aún no hay documentos disponibles sin conexión.',
  uwOfflineCapReached:
    'La biblioteca sin conexión de este equipo ha llegado a su límite: almacenamiento {cap}; máximo de documentos: {maxDocs}. Quita una copia sin conexión para añadir otra.',
  uwOfflineReady: 'Disponible sin conexión',
  uwOfflineBadgeWaiting: 'Esperando red',
  uwOfflineBadgeDownloading: 'Descargando',
  uwOfflineBadgeVerifying: 'Verificando',
  uwOfflineBadgeUpdate: 'Actualización disponible',
  uwOfflineBadgeInterrupted: 'No está listo',
  uwOfflineBadgeDiskFull: 'Espacio insuficiente',
  uwOfflineBadgeCorrupt: 'Descarga dañada',
  uwOfflineBadgeLeaseSoon: 'El acceso sin conexión termina pronto',
  uwOfflineBadgeViewOnly: 'Disponible sin conexión · solo lectura',
  uwOfflineRowWaiting: 'Se descargará cuando haya conexión',
  uwOfflineRowProgress: '{done} de {total}',
  uwOfflineRowProgressAria: '{done} de {total}',
  uwOfflineRowVerifying: 'Comprobando la integridad',
  uwOfflineRowReady: 'Versión {n} · {size} · acceso sin conexión hasta {datetime}',
  uwOfflineRowUpdate:
    'La versión {n} se descargará cuando haya conexión; la versión {old} sigue funcionando',
  uwOfflineRowUpdateKept:
    'No se pudo actualizar a la versión {n}: {reason}. La versión {old} sigue funcionando.',
  uwOfflineRowInterrupted:
    'La descarga se interrumpió. La copia anterior (si la hay) sigue funcionando.',
  uwOfflineRowDiskFull: 'Se necesitan {size} más. La copia anterior se conserva.',
  uwOfflineRowCorrupt: 'Se eliminó la copia dañada. Vuelve a descargarla.',
  uwOfflineRowLeaseSoon: 'Conéctate antes de {datetime} para renovar',
  uwOfflineRowRevoked:
    'Ya no tienes acceso a este documento. Se eliminó la copia descargada; los borradores siguen bloqueados.',
  uwOfflineRowDeleted:
    'El documento se eliminó en UniWork. Se eliminó la copia descargada; los borradores siguen bloqueados.',
  uwOfflineRowArchived:
    'El documento se archivó; la copia de aquí se abre hasta que termine el acceso sin conexión.',
  uwOfflineRowMoved: 'Movido a {workspace}; la copia de aquí sigue funcionando.',
  uwOfflineRowViewOnly: 'Versión {n} · solo lectura · acceso sin conexión hasta {datetime}',
  uwOfflineReadyAnnounce: 'Disponible sin conexión: {doc}',
  uwOfflineUnpinConfirm:
    'La copia descargada se eliminará de este equipo. Los borradores y guardados en cola se conservan.',
  uwOfflineCancelDownload: 'Cancelar descarga',
  uwOfflineDownloadNow: 'Descargar ahora',
  uwOfflineOpenFolder: 'Abrir carpeta de almacenamiento',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Hay que reconectar',
  uwLockKeystoreTitle: 'El llavero de este equipo está bloqueado',
  uwLockClockTitle: 'Hay que comprobar la hora',
  uwLockRevokedTitle: 'Sin acceso',
  uwLockDeletedTitle: 'Documento eliminado',
  uwLockForeignTitle: 'Pertenece a otra cuenta',
  uwLockOrgTitle: 'No se puede abrir en esta organización',
  uwLockExpired:
    'El acceso sin conexión ha caducado. El contenido sigue cifrado; conéctate para volver a abrirlo.',
  uwLockLibraryOff:
    'Tu administrador desactivó los documentos sin conexión, así que el acceso sin conexión no se puede renovar. Los borradores siguen bloqueados en el centro de sincronización.',
  uwLockKeystore:
    'El llavero del equipo está bloqueado, así que el contenido cifrado no se puede abrir. Desbloquéalo y vuelve a intentarlo; no se ha eliminado nada.',
  uwLockClock:
    'El reloj del equipo se atrasó, así que el acceso sin conexión está bloqueado. Conéctate para que UniWork compruebe la hora.',
  uwLockForeign:
    'Este documento pertenece a otra cuenta de este equipo. Cambia a esa cuenta para abrirlo.',
  uwLockSuspended:
    'La organización está suspendida. El contenido sigue cifrado; ponte en contacto con tu administrador.',
  uwLockDeactivated:
    'Tu cuenta está desactivada en esta organización. El contenido sigue cifrado; ponte en contacto con tu administrador.',
  uwLockSignedOutTitle: 'Has cerrado sesión',
  uwLockSignedOut:
    'El contenido sigue bloqueado en este equipo. Inicia sesión con la misma cuenta para volver a abrirlo.',
  uwLockRegion: 'Estado del documento',
  uwLockWhileOpen:
    'El documento se bloqueó mientras estaba abierto. Los cambios sin guardar se conservan cifrados; no puedes guardar ni copiar hasta que se desbloquee.',
  uwLockWhileOpenRam:
    'El documento se bloqueó mientras estaba abierto y este equipo aún no puede conservar tus cambios de forma segura. Solo existen en esta ventana (solo lectura); si la cierras, se perderán.',
  uwLockOtherWindow:
    'Este documento está abierto para editar en otra ventana. Esta ventana es de solo lectura.',
  uwLockOtherWindowGone:
    'La ventana que editaba este documento dejó de responder. Puedes editar en esta ventana.',
  uwLockGoToWindow: 'Ir a esa ventana',
  uwLockTakeEdit: 'Editar en esta ventana',

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
  uwConflictSaveCopyTitle: '¿Guardar como copia?',
  uwConflictSaveCopyConfirm:
    'UniWork creará un documento nuevo a partir de tu versión, con el mismo propietario y acceso que este documento. El documento actual y la versión {server} de {author} no cambian.',
  uwConflictSaveCopyGo: 'Crear copia',
  uwConflictSaveCopyDone:
    'Tu versión se guardó como documento nuevo: {title}. Este documento no ha cambiado; aún puedes recargar o sobrescribir.',
  uwConflictSaveCopyFailed:
    'No se pudo crear la copia. Tus cambios siguen a salvo; vuelve a intentarlo.',
  uwConflictSaveCopyNoSeat:
    'No se pudo crear la copia porque no eres miembro del espacio de trabajo en el que está este documento. Tus cambios siguen a salvo; puedes descargar tu versión.',
  uwConflictSaveCopyFolderRefused:
    'No puedes crear documentos en esta carpeta. Descarga tu versión en su lugar.',
  uwConflictDownloadDone:
    'Tu versión se guardó en este equipo: {file}. Este documento no ha cambiado; aún puedes recargar o sobrescribir.',
  uwConflictDownloadFailedDesktop:
    'No se pudo guardar el archivo. Tus cambios siguen a salvo; vuelve a intentarlo.',
  uwConflictSaveCopyOffline:
    'No tienes conexión. Para crear una copia se necesita conexión; tus cambios se conservan.',
  uwConflictReloadFailed:
    'No se pudo cargar la última versión. Tu documento no ha cambiado; vuelve a intentarlo.',
  uwConflictOverwriteFailed:
    'Aún no se pudo sobrescribir. Tu documento no ha cambiado; vuelve a intentarlo.',
  uwConflictClose: 'Cerrar',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Este documento se modificó en otro lugar',
  uwConflictBody: 'Tus cambios aún no están en UniWork y están a salvo en este equipo.',
  uwConflictReload: 'Recargar la última versión',
  uwConflictOverwrite: 'Sobrescribir…',
  uwConflictCancel: 'Cancelar',
  uwConflictKeepUnavailable:
    'Este equipo no puede guardar un borrador ahora (almacenamiento de sincronización lleno o llavero bloqueado).',
  uwConflictOfflineDesktop:
    'No tienes conexión y la última versión no está en este equipo, así que aún no se puede recargar.',
  uwConflictReloadDesktopBody:
    'Elige qué pasa con tus cambios antes de que se cargue la versión {n}.',
  uwConflictKeepDraft: 'Guardar mi versión como borrador',
  uwConflictDiscard: 'Descartar mis cambios',
  uwConflictKeepDraftHint:
    'El borrador queda en el centro de sincronización para verlo o copiarlo; nunca se aplica automáticamente a la nueva versión.',
  uwConflictDraftCapReached:
    'Este documento alcanzó el número máximo de borradores guardados: {cap}. Descarta un borrador antiguo en el centro de sincronización para guardar otro.',

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
  uwRemoteWaitCommit: 'Esperando a que termine el guardado en curso; después podrás continuar.',
  uwRemoteReload: 'Recargar la última versión…',
  uwRemoteLater: 'Más tarde',
  uwRemoteClose: 'Cerrar',
  uwRemoteReloadFailed: 'No se pudo cargar la versión {n}. Sigues viendo la versión anterior.',
  uwRemoteDeleted: 'Este documento se eliminó en UniWork. Los guardados en cola se detuvieron.',
  uwAuthorFallback: 'un miembro',

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'El guardado anterior necesita soporte, así que aún no puedes recargar ni sobrescribir. Abre el centro de sincronización para resolverlo.',
  uwRemoteRevoked:
    'Ya no tienes acceso a este documento. Se detuvo el guardado; los cambios sin guardar se conservan bloqueados en este equipo.',
} satisfies Record<keyof typeof zh, string>
