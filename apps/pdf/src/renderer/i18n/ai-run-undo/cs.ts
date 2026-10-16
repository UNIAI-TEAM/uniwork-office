import type { zh } from './zh'

export const cs = {
  aiRunUndo: 'Vrátit tento běh',
  aiRunUndoDone: 'Běh vrácen',
  aiRunUndoLater:
    'Po tomto běhu následovaly další změny. Nejprve je vraťte zpět a pak vraťte tento běh.',
  aiRunUndoBusy: 'Dostupné, až asistent skončí.',
  aiEditsPaused:
    'Asistent pracuje na tomto dokumentu. Vaše úpravy jsou pozastaveny; pro pokračování asistenta zastavte.',
} satisfies Record<keyof typeof zh, string>
