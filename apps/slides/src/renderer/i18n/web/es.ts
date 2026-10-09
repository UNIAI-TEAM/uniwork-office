import type { zh } from './zh'

export const es = {
  webConflictTitle: 'Esta presentación se modificó en otro lugar',
  webConflictBody:
    'Alguien guardó una versión más reciente. Sobrescribir la reemplaza con tus cambios; Recargar la última descarta tus cambios y abre la versión más reciente.',
  webConflictOverwrite: 'Sobrescribir',
  webConflictReload: 'Recargar la última',
  webConflictNotSaved: 'la presentación se modificó en otro lugar',
  webDiscardTitle: '¿Descartar los cambios no guardados?',
  webDiscardBody: 'Esta presentación tiene cambios sin guardar. Abrir otro archivo los perderá.',
  webDiscard: 'Descartar y abrir',
  webCancel: 'Cancelar',
  webOk: 'Aceptar',
  webFatalTitle: 'No se pudo abrir la presentación',
  webFatalBody:
    'No se pudo cargar el archivo desde UniWork. Cierra esta pestaña e inténtalo de nuevo.',
  webNoHost: 'Este editor se ejecuta dentro de UniWork. Abre la presentación desde UniWork.',
  webLegacyPpt:
    'Es un archivo .ppt antiguo y no se puede abrir en el navegador. Guárdalo primero como .pptx en PowerPoint.',
  webEncryptedPptx:
    'Esta presentación está protegida con contraseña y no se puede abrir en el navegador.',
  webCommentAuthor: 'Usuario',
  webExternalMedia:
    'Los medios externos vinculados solo se reproducen en la aplicación de escritorio.',
  webReadOnly: 'Esta presentación es de solo lectura.',
} satisfies Record<keyof typeof zh, string>
