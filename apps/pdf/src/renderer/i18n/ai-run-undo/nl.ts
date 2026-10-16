import type { zh } from './zh'

export const nl = {
  aiRunUndo: 'Deze uitvoering ongedaan maken',
  aiRunUndoDone: 'Uitvoering ongedaan gemaakt',
  aiRunUndoLater:
    'Na deze uitvoering zijn er nog andere wijzigingen gedaan. Maak die eerst ongedaan en daarna de uitvoering.',
  aiRunUndoBusy: 'Beschikbaar zodra de assistent klaar is.',
  aiEditsPaused:
    'De assistent werkt aan dit document. Je bewerkingen zijn gepauzeerd; stop de assistent om door te gaan.',
} satisfies Record<keyof typeof zh, string>
