import type { zh } from './zh'

export const fr = {
  aiRunUndo: 'Annuler cette exécution',
  aiRunUndoDone: 'Exécution annulée',
  aiRunUndoLater:
    'Des modifications ont été faites après cette exécution. Annulez-les d’abord, puis annulez l’exécution.',
  aiRunUndoBusy: 'Disponible quand l’assistant a terminé.',
} satisfies Record<keyof typeof zh, string>
