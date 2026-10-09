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
  webViewOnly: '表示のみ',
  webViewOnlyNotSaved: 'このドキュメントは表示のみのため保存できません',
  webNotUtf8:
    'このファイルは UTF-8 テキストではありません。保存で内容が変わらないよう表示のみで開きます',
  webDraftTitle: '保存されていない変更を復元しますか？',
  webDraftBody:
    'このブラウザーに、この文書の保存されていない変更のコピーが残っています。復元しますか、それとも破棄しますか？',
  webDraftOlder:
    'このコピーは文書の古いバージョンに基づいています。保存すると新しいバージョンが置き換えられます。',
  webDraftSavedAt: 'コピーの保存時刻',
  webDraftRestore: '復元',
  webDraftDiscard: '破棄',
} satisfies Record<keyof typeof zh, string>
