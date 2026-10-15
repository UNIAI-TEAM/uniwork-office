import type { zh } from './zh'

export const fr = {
  aiRunUndo: 'Annuler cette exécution',
  aiRunUndoDone: 'Exécution annulée',
  aiRunUndoLater:
    'Des modifications ont été faites après cette exécution. Annulez-les d’abord, puis annulez l’exécution.',
  aiRunUndoBusy: 'Disponible quand l’assistant a terminé.',
  aiEditsPaused:
    "L'assistant modifie ce document. Vos modifications sont suspendues ; arrêtez l'assistant pour continuer.",
} satisfies Record<keyof typeof zh, string>
