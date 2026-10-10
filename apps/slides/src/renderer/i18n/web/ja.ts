import type { zh } from './zh'

export const ja = {
  webConflictTitle: 'このプレゼンテーションは別の場所で変更されました',
  webConflictBody:
    '新しいバージョンが保存されています。上書きするとあなたの変更で置き換えます。最新を再読み込みすると変更を破棄して最新版を開きます。',
  webConflictOverwrite: '上書き',
  webConflictReload: '最新を再読み込み',
  webConflictNotSaved: 'プレゼンテーションは別の場所で変更されました',
  webDiscardTitle: '保存されていない変更を破棄しますか?',
  webDiscardBody:
    'このプレゼンテーションには保存されていない変更があります。別のファイルを開くと失われます。',
  webDiscard: '破棄して開く',
  webCancel: 'キャンセル',
  webOk: 'OK',
  webFatalTitle: 'プレゼンテーションを開けませんでした',
  webFatalBody: 'UniWork からファイルを読み込めませんでした。このタブを閉じて再試行してください。',
  webNoHost:
    'このエディターは UniWork 内で動作します。UniWork からプレゼンテーションを開いてください。',
  webLegacyPpt:
    'これは古い .ppt ファイルのため、ブラウザーでは開けません。先に PowerPoint で .pptx として保存してください。',
  webEncryptedPptx:
    'このプレゼンテーションはパスワードで保護されているため、ブラウザーでは開けません。',
  webCommentAuthor: 'ユーザー',
  webExternalMedia: 'リンクされた外部メディアはデスクトップ アプリでのみ再生できます。',
  webReadOnly: 'このプレゼンテーションは読み取り専用です。',
  webSaveNetwork: 'UniWork に接続できませんでした。接続を確認してもう一度お試しください。',
  webSaveTimeout: '保存に時間がかかりすぎました。接続を確認してもう一度お試しください。',
  webFullscreenHint: 'クリックまたは任意のキーで全画面表示にします',
} satisfies Record<keyof typeof zh, string>
