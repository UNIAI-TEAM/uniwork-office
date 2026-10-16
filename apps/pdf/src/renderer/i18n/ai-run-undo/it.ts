import type { zh } from './zh'

export const it = {
  aiRunUndo: 'Annulla questa esecuzione',
  aiRunUndoDone: 'Esecuzione annullata',
  aiRunUndoLater:
    'Dopo questa esecuzione ci sono altre modifiche. Annullale prima, poi annulla l’esecuzione.',
  aiRunUndoBusy: 'Disponibile quando l’assistente ha finito.',
  aiEditsPaused:
    "L'assistente sta lavorando a questo documento. Le tue modifiche sono in pausa; ferma l'assistente per continuare.",
} satisfies Record<keyof typeof zh, string>
