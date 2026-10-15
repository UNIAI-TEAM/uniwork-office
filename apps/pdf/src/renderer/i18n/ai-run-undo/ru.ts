import type { zh } from './zh'

export const ru = {
  aiRunUndo: 'Отменить этот запуск',
  aiRunUndoDone: 'Запуск отменён',
  aiRunUndoLater:
    'После этого запуска были другие изменения. Сначала отмените их, затем отмените запуск.',
  aiRunUndoBusy: 'Доступно, когда помощник закончит.',
} satisfies Record<keyof typeof zh, string>
