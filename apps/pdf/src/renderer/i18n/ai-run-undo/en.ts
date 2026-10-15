import type { zh } from './zh'

export const en = {
  aiRunUndo: 'Undo this run',
  aiRunUndoDone: 'Run undone',
  aiRunUndoLater: 'Later changes sit on top of this run. Undo them first, then undo the run.',
  aiRunUndoBusy: 'Available once the assistant has finished.',
} satisfies Record<keyof typeof zh, string>
