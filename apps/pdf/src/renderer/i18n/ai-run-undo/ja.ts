import type { zh } from './zh'

export const ja = {
  aiRunUndo: 'この実行を元に戻す',
  aiRunUndoDone: '実行を元に戻しました',
  aiRunUndoLater:
    'この実行のあとに別の変更があります。先にそれらを元に戻してから、この実行を元に戻してください。',
  aiRunUndoBusy: 'アシスタントの処理が終わると使えます。',
  aiEditsPaused:
    'アシスタントがこのドキュメントを処理中です。あなたの編集は一時停止されています。続けるにはアシスタントを停止してください。',
} satisfies Record<keyof typeof zh, string>
