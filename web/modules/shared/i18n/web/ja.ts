import type { zh } from './zh'

export const ja = {
  webCancel: 'キャンセル',
  webConflictTitle: 'このドキュメントは別の場所で変更されました',
  webConflictBody: '変更はまだ UniWork になく、ログアウトするまでこのブラウザーに保持されます。',
  webConflictOverwrite: '上書き…',
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
  webDraftKept: 'このコピーは、サインアウトするまでこのブラウザーに保存されます。',
  webDraftRestore: '復元',
  webDraftDiscard: '破棄',
  webSaveNetwork: 'UniWork に接続できませんでした。接続を確認してもう一度お試しください。',
  webSaveTimeout: '保存に時間がかかりすぎました。接続を確認してもう一度お試しください。',
  webClose: '閉じる',
  webSaveUnauthorized:
    'UniWork のセッションが終了しました。もう一度サインインしてから保存してください。',
  webSaveForbidden: 'このドキュメントを保存する権限がありません。',
  webSaveNotFound: 'このドキュメントは存在しないか、移動されました。',
  webSaveTooLarge: 'ドキュメントが大きすぎて保存できません。',
  webSaveRateLimited: 'リクエストが多すぎます。しばらく待ってからもう一度お試しください。',
  webSaveServer: 'UniWork で保存中に問題が発生しました。しばらくしてからもう一度お試しください。',
  webSaveFailedGeneric: 'ドキュメントを保存できませんでした。もう一度お試しください。',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    '変更はまだ UniWork になく、ログアウトするまでこのブラウザーに保持されます。',
  uwConflictReloadWebBody:
    'ブラウザーは競合の下書きを保持しません。後でコピーできるよう自分のバージョンをダウンロードするか、変更を破棄してください。',
  uwConflictDownloadThenReload: '自分のバージョンをダウンロードしてから再読み込み',
  uwConflictDiscardThenReload: '変更を破棄して再読み込み',
  uwConflictMineFileSuffix: '（自分のバージョン）',
  uwConflictDownloadCheck:
    'ブラウザーがファイルを受け取りました。保存されたことを確認してから「再読み込み」を選んでください。',
  uwConflictSessionWeb:
    'セッションの有効期限が切れたため、上書きされませんでした。変更はこのブラウザーに残っています。再ログインしてもう一度お試しください。',
  uwConflictTooLarge:
    'あなたのバージョンは UniWork のサイズ上限を超えているため、上書きできませんでした。',
  uwConflictDownloadTooLarge:
    'あなたのバージョンは UniWork のサイズ上限を超えているため、ここではダウンロードできません。',
  uwConflictDownloadFailed:
    'あなたのバージョンをダウンロードできなかったため、ドキュメントは再読み込みされませんでした。もう一度お試しください。',
  uwConflictOfflineWeb:
    'オフラインです。Web ではこの操作に接続が必要です。変更はこのブラウザーに残っています。',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'あなたのバージョン',
  uwConflictColServer: 'UniWork のバージョン',
  uwConflictRowVersion: 'バージョン',
  uwConflictRowTime: '時刻',
  uwConflictRowBy: '保存者',
  uwConflictMineUnsaved: 'あなた（未保存）',
  uwConflictBasedOn: 'バージョン {n} に基づく',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: '差分を表示',
  uwConflictDiffPending: '比較しています…',
  uwConflictDiffFailed: '今はバージョンを比較できません。後でもう一度お試しください。',
  uwConflictNoEdit: 'このドキュメントの編集権限がなくなりました。',
  uwConflictOverwriteTitle: 'あなたのバージョンで上書きしますか？',
  uwConflictOverwriteConfirm:
    'UniWork はあなたのコピーからバージョン {next} を作成します。{author} のバージョン {server} は履歴に残ります。',
  uwConflictOverwriteGo: '上書き',
  uwConflictBack: '戻る',
  uwConflictHeadMoved:
    'その間に UniWork にバージョン {n} ができました。表を更新しました。もう一度選んでください。',
  uwConflictReloadTitle: '最新版を再読み込み',
  uwConflictReloadGo: '再読み込み',
  uwConflictSaveCopy: 'コピーとして保存…',
  uwConflictSaveCopyName: '{name}（コピー）',
  uwConflictSaveCopyTitle: 'コピーとして保存しますか？',
  uwConflictSaveCopyConfirm:
    'UniWork はあなたのバージョンから、このドキュメントと同じ所有者とアクセス権を持つ新しいドキュメントを作成します。現在のドキュメントと {author} のバージョン {server} はそのまま残ります。',
  uwConflictSaveCopyGo: 'コピーを作成',
  uwConflictSaveCopyDone:
    'あなたのバージョンを新しいドキュメントとして保存しました：{title}。このドキュメントは変わっていません。再読み込みまたは上書きを選ぶこともできます。',
  uwConflictSaveCopyFailed:
    'コピーを作成できませんでした。変更は引き続き安全です。もう一度お試しください。',
  uwConflictSaveCopyOffline: 'オフラインです。コピーの作成には接続が必要です。変更は保持されます。',
  uwConflictReloadFailed:
    '最新バージョンを読み込めませんでした。ドキュメントは変わっていません。もう一度お試しください。',
  uwConflictOverwriteFailed:
    'まだ上書きできませんでした。ドキュメントは変わっていません。もう一度お試しください。',
  uwConflictClose: '閉じる',

  // S6 new-version bar
  uwRemoteRegion: '新しいバージョン',
  uwRemoteUpdated: 'バージョン {n} に更新しました（{author} が {time} に保存）。',
  uwRemoteUpdatedNoRev: 'UniWork の最新バージョンに更新しました。',
  uwRemoteNewerDirty:
    'UniWork に新しいバージョンがあります（バージョン {n}）。未保存の変更があるため、ドキュメントは再読み込みされませんでした。',
  uwRemoteNewerAi:
    'UniWork に新しいバージョンがあります（バージョン {n}）。UniWork AI が実行中のため、ドキュメントは再読み込みされませんでした。AI の結果は開いているコピーにのみ適用されます。',
  uwRemoteNowClean:
    'すべての変更を元に戻しました。UniWork のバージョン {n} は開いているコピーより新しいです。',
  uwRemoteStopAiConfirm:
    '再読み込みのために実行中の UniWork AI を停止しますか？AI がすでに行った変更は開いているコピーのものです。',
  uwRemoteWaitCommit: '進行中の保存が終わるのを待っています。その後で再読み込みできます。',
  uwRemoteReload: '最新版を再読み込み…',
  uwRemoteLater: '後で',
  uwRemoteClose: '閉じる',
  uwRemoteReloadFailed: 'バージョン {n} を読み込めませんでした。前のバージョンを表示したままです。',
  uwRemoteDeleted: 'このドキュメントは UniWork で削除されました。保存待ちは停止しました。',
  uwAuthorFallback: 'メンバー',
  uwLockRegion: 'ドキュメントの状態',
  uwActRetry: '再試行',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'このドキュメントへのアクセス権がなくなりました。保存は停止しました。未保存の変更はログアウトするまでこのブラウザーに保持されます。',
  uwRemoteOrgBlockedWeb:
    '保存できませんでした：{reason}。未保存の変更はログアウトするまでこのブラウザーに保持されます。',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'ドキュメントはアーカイブ済み',
  uwReasonSuspended: '組織が停止中',
  uwReasonDeactivated: 'この組織であなたのアカウントは無効化されています',

  webSizeWarnChip: '上限 {max} に近づいています（現在 {size}）。',
  webSaveBlockTitle: 'UniWork に保存できませんでした',
  webSaveBlockBody:
    'このドキュメントは {max} を超えています。変更内容はここに残っています。自分のコピーをパソコンにダウンロードしてから、画像サイズを縮小するかドキュメントを分割してください。',
  webSaveBlockDownload: '自分のコピーをダウンロード',
  uwConflictTooLargeWithLimit:
    'あなたのバージョンは {max} を超えています（現在 {size}）。「自分のコピーをダウンロード」を選択するか、このダイアログを閉じてファイルサイズを縮小してください。',
  uwConflictSaveCopyTooLarge:
    'あなたのバージョンは UniWork のサイズ上限を超えているため、コピーを作成できませんでした。このダイアログを閉じてファイルサイズを縮小するか、「最新版を再読み込み」を選択して自分のバージョンをダウンロードしてください。',
  uwConflictSaveCopyTooLargeWithLimit:
    'あなたのバージョンは {max} を超えているため（現在 {size}）、コピーを作成できませんでした。このダイアログを閉じてファイルサイズを縮小するか、「最新版を再読み込み」を選択して自分のバージョンをダウンロードしてください。',
} satisfies Record<keyof typeof zh, string>
