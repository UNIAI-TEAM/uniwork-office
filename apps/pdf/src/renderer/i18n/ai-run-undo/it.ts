import type { zh } from './zh'

export const it = {
  aiRunUndo: 'Annulla questa esecuzione',
  aiRunUndoDone: 'Esecuzione annullata',
  aiRunUndoLater:
    'Dopo questa esecuzione ci sono altre modifiche. Annullale prima, poi annulla l’esecuzione.',
  aiRunUndoBusy: 'Disponibile quando l’assistente ha finito.',
} satisfies Record<keyof typeof zh, string>
