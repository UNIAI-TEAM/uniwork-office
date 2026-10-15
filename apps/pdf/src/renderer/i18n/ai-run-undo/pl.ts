import type { zh } from './zh'

export const pl = {
  aiRunUndo: 'Cofnij to uruchomienie',
  aiRunUndoDone: 'Uruchomienie cofnięte',
  aiRunUndoLater:
    'Po tym uruchomieniu wprowadzono kolejne zmiany. Najpierw cofnij je, a potem to uruchomienie.',
  aiRunUndoBusy: 'Dostępne, gdy asystent skończy.',
} satisfies Record<keyof typeof zh, string>
