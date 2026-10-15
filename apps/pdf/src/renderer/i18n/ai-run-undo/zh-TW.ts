import type { zh } from './zh'

export const zhTW = {
  aiRunUndo: '復原本次操作',
  aiRunUndoDone: '已復原本次操作',
  aiRunUndoLater: '此後又有新的修改。請先復原它們，再復原本次操作。',
  aiRunUndoBusy: 'AI 助理完成後即可使用。',
  aiEditsPaused: 'AI 助理正在編輯此文件，您的編輯已暫停；停止助理後即可繼續。',
} satisfies Record<keyof typeof zh, string>
