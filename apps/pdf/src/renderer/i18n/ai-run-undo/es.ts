import type { zh } from './zh'

export const es = {
  aiRunUndo: 'Deshacer esta ejecución',
  aiRunUndoDone: 'Ejecución deshecha',
  aiRunUndoLater:
    'Hay cambios posteriores a esta ejecución. Deshazlos primero y luego deshaz la ejecución.',
  aiRunUndoBusy: 'Disponible cuando el asistente termine.',
  aiEditsPaused:
    'El asistente está editando este documento. Tus ediciones están en pausa; detén al asistente para continuar.',
} satisfies Record<keyof typeof zh, string>
