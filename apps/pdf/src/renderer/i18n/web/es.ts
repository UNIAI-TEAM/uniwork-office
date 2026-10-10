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
  webReloaded: 'se recargó la versión más reciente y se descartaron tus cambios',
  webViewOnlyNoSave: 'este documento es de solo lectura',
  webMergeTitle: 'Combinar PDF',
  webMergeBody: '{count} PDF seleccionado(s). ¿Añadir otro PDF o combinar ahora?',
  webMergeAdd: 'Añadir otro PDF',
  webMergeNow: 'Combinar ahora',
  webSaveNetwork: 'No se pudo conectar con UniWork. Revisa tu conexión e inténtalo de nuevo.',
  webSaveTimeout: 'Guardar tardó demasiado. Revisa tu conexión e inténtalo de nuevo.',
  webAppOnlyHint: 'Abre en la aplicación UniWork Office para usar esta función',
  webAppOnlyOpen: 'Abrir en la aplicación',
  webAppOnlyOcr:
    'Este PDF tiene páginas escaneadas. El reconocimiento de texto (OCR) no está disponible aquí.',
  webAppOnlyConvert: 'La conversión de un PDF a Word, Excel o PowerPoint no está disponible aquí.',
  webAppOnlyRedact: 'La redacción (eliminar de forma permanente el contenido marcado) no está disponible aquí.',
} satisfies Record<keyof typeof zh, string>
