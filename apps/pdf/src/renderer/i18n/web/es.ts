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
} satisfies Record<keyof typeof zh, string>
