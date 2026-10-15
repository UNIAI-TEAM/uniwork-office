import type { zh } from './zh'

export const de = {
  aiRunUndo: 'Diesen Lauf rückgängig machen',
  aiRunUndoDone: 'Lauf rückgängig gemacht',
  aiRunUndoLater:
    'Nach diesem Lauf gab es weitere Änderungen. Machen Sie diese zuerst rückgängig, dann den Lauf.',
  aiRunUndoBusy: 'Verfügbar, sobald der Assistent fertig ist.',
  aiEditsPaused:
    'Der Assistent bearbeitet dieses Dokument. Ihre Änderungen sind pausiert; beenden Sie den Assistenten, um fortzufahren.',
} satisfies Record<keyof typeof zh, string>
