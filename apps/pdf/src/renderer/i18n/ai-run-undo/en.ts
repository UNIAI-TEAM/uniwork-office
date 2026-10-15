import type { zh } from './zh'

export const en = {
  aiRunUndo: 'Undo this run',
  aiRunUndoDone: 'Run undone',
  aiRunUndoLater: 'Later changes sit on top of this run. Undo them first, then undo the run.',
  aiRunUndoBusy: 'Available once the assistant has finished.',
  aiEditsPaused:
    'The assistant is editing this document. Your edits are paused; stop the assistant to continue.',
} satisfies Record<keyof typeof zh, string>
