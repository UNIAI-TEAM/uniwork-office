import type { zh } from './zh'

export const vi = {
  aiRunUndo: 'Hoàn tác lượt này',
  aiRunUndoDone: 'Đã hoàn tác lượt này',
  aiRunUndoLater: 'Đã có thay đổi sau lượt này. Hãy hoàn tác chúng trước, rồi hoàn tác lượt này.',
  aiRunUndoBusy: 'Dùng được khi trợ lý làm xong.',
} satisfies Record<keyof typeof zh, string>
