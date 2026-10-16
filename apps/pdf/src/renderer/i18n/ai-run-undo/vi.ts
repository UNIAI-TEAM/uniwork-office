import type { zh } from './zh'

export const vi = {
  aiRunUndo: 'Hoàn tác lượt này',
  aiRunUndoDone: 'Đã hoàn tác lượt này',
  aiRunUndoLater: 'Đã có thay đổi sau lượt này. Hãy hoàn tác chúng trước, rồi hoàn tác lượt này.',
  aiRunUndoBusy: 'Dùng được khi trợ lý làm xong.',
  aiEditsPaused:
    'Trợ lý đang làm việc với tài liệu này. Bạn tạm thời không sửa được; hãy dừng trợ lý để tiếp tục.',
} satisfies Record<keyof typeof zh, string>
