import type { zh } from './zh'

export const es = {
  aiRunUndo: 'Deshacer esta ejecución',
  aiRunUndoDone: 'Ejecución deshecha',
  aiRunUndoLater:
    'Hay cambios posteriores a esta ejecución. Deshazlos primero y luego deshaz la ejecución.',
  aiRunUndoBusy: 'Disponible cuando el asistente termine.',
} satisfies Record<keyof typeof zh, string>
