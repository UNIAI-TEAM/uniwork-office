import type { zh } from './zh'

export const ru = {
  aiRunUndo: 'Отменить этот запуск',
  aiRunUndoDone: 'Запуск отменён',
  aiRunUndoLater:
    'После этого запуска были другие изменения. Сначала отмените их, затем отмените запуск.',
  aiRunUndoBusy: 'Доступно, когда помощник закончит.',
  aiEditsPaused:
    'Ассистент редактирует этот документ. Ваши правки приостановлены; остановите ассистента, чтобы продолжить.',
} satisfies Record<keyof typeof zh, string>
