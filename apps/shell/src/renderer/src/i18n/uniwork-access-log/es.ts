import type { zh } from './zh'

export const es = {
  algMenu: 'Registro de acceso',
  algTitle: 'Registro de acceso',
  algDescription:
    'Quién vio, descargó o abrió el documento mediante un enlace. Solo los administradores pueden leerlo.',
  algManageOnly: 'Necesitas permiso de gestión para leer el registro de acceso.',
  algLoading: 'Cargando el registro…',
  algError: 'No se pudo cargar el registro de acceso.',
  algEmpty: 'Aún no hay accesos registrados.',
  algFilterLabel: 'Acción',
  algFilterAll: 'Todas las acciones',
  algActionView: 'Ver',
  algActionDownload: 'Descargar',
  algActionExport: 'Exportar',
  algActionLinkView: 'Abierto mediante enlace',
  algActionUnknown: 'Otro',
  algActorAnonymous: 'Anónimo',
  algActorSystem: 'Sistema',
  algActorUnknown: 'Desconocido',
  algVersion: 'versión {no}',
} satisfies Record<keyof typeof zh, string>
