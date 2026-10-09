import type { zh } from './zh'

export const ja = {
  webCancel: 'キャンセル',
  webConflictTitle: 'このドキュメントは別の場所で変更されました',
  webConflictBody:
    '編集中に新しいバージョンが保存されました。自分のバージョンで上書きしますか?それとも最新バージョンを再読み込みして変更を破棄しますか?',
  webConflictOverwrite: '上書き',
  webConflictReload: '最新版を再読み込み',
  webConflictNotSaved: 'ドキュメントは別の場所で変更されています',
  webFatalTitle: 'ドキュメントを開けませんでした',
  webFatalBody:
    '編集と保存は無効になっています。ページを再読み込みするか、UniWork からドキュメントを開き直してください。',
  webNoHost: 'このエディターは UniWork 内で動作します。UniWork からドキュメントを開いてください。',
  webViewOnly: '閲覧のみ',
  webReloaded: '最新バージョンを再読み込みしました。変更は破棄されました',
  webViewOnlyNoSave: 'この文書は閲覧のみです',
  webMergeTitle: 'PDF を結合',
  webMergeBody:
    '{count} 個の PDF を選択しました。さらに PDF を追加しますか、それとも今すぐ結合しますか?',
  webMergeAdd: 'PDF をさらに追加',
  webMergeNow: '今すぐ結合',
} satisfies Record<keyof typeof zh, string>
