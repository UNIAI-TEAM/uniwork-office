import type { zh } from './zh'

export const es = {
  webCancel: 'Cancelar',
  webConflictTitle: 'Este documento se modificó en otro lugar',
  webConflictBody:
    'Se guardó una versión más reciente mientras editabas. ¿Quieres sobrescribirla con tu versión o volver a cargar la última versión y descartar tus cambios?',
  webConflictOverwrite: 'Sobrescribir',
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
} satisfies Record<keyof typeof zh, string>
