import type { zh } from './zh'

export const ja = {
  setRestoreSession: '前回のドキュメントを再度開く',
  setRestoreSessionDesc:
    'UniWork Office を閉じたときに開いていたドキュメントを、次回起動時に自動で開き直します。',
  setAutoUpdateCheck: 'アップデートを自動で確認',
  setAutoUpdateCheckDesc:
    'オフにすると、起動時やバックグラウンドで新しいバージョンを確認しなくなります。「ヘルプ › 更新を確認」から手動で確認できます。',
} satisfies Record<keyof typeof zh, string>
