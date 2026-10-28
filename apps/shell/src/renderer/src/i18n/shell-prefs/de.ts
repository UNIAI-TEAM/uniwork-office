import type { zh } from './zh'

export const de = {
  setRestoreSession: 'Dokumente vom letzten Mal wieder öffnen',
  setRestoreSessionDesc:
    'Dokumente, die beim Schließen von UniWork Office geöffnet waren, werden beim nächsten Start automatisch wieder geöffnet.',
  setAutoUpdateCheck: 'Automatisch nach Updates suchen',
  setAutoUpdateCheckDesc:
    'Wenn aus, sucht UniWork Office weder beim Start noch im Hintergrund nach neuen Versionen. Über Hilfe › Nach Updates suchen können Sie weiterhin selbst prüfen.',
} satisfies Record<keyof typeof zh, string>
