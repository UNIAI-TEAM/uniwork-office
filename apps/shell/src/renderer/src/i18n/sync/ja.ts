import type { zh } from './zh'

export const ja = {
  // S1 save pill: chips and tooltips
  uwChipQueued: '保存待ち — まだ UniWork にありません',
  uwChipQueuedNewer: '保存待ち · 新しい編集あり',
  uwChipPausedAdmin: '保存待ち · 送信は一時停止中',
  uwChipReconciling: '前回の保存を確認しています…',
  uwChipReconcileStuck: '保存の確認にサポートが必要です',
  uwChipRemoteNewer: 'UniWork に新しいバージョンがあります',
  uwTipQueued:
    '{time} の保存はこのコンピューターに安全に保持され、オンラインになると送信されます。',
  uwTipQueuedNewer: '{time} の保存は送信待ちです。それ以降の編集は含まれていません。',
  uwTipPausedAdmin:
    '管理者が送信を一時停止しています。保存内容はこのコンピューターに保持されます。',
  uwTipPausedUser:
    '送信を一時停止しています。{time} の保存はこのコンピューターに保持されます。同期センターで「送信を再開」を選んでください。',
  uwTipReconciling:
    '前回の保存が UniWork に届いたかまだわかりません。アプリが確認中で、重複は作成しません。',
  uwTipRemoteNewer: '未保存の変更があるため、ドキュメントは再読み込みされませんでした。',
  uwTipFailed:
    'この保存は自動では再試行されません：{reason}。変更はこのコンピューターに残っています。',
  uwTipWaitAi: 'AI が現在のステップを終えるのを待ってから保存します。',
  uwTipWaitAiLong:
    'AI は現在のステップをまだ終えていません。今すぐ保存するには AI の実行を停止してください。',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'キューを表示',
  uwActSaveAgain: 'もう一度保存',
  uwActStopAi: 'AI を停止',
  uwActBack: '戻る',
  uwQueuePopWaiting: '保存待ち：{time} の内容（バージョン {base} に基づく）',
  uwQueuePopNewer: 'その後の新しい編集 — 未送信',
  uwQueueBlockedSave: '前回の保存がまだ待機中です。完了すると再度保存できます。',
  uwQueueFull:
    'このコンピューターの同期ストレージがいっぱいのため、保存はキューに追加されませんでした。変更は開いているウィンドウに残っています。同期センターで空き容量を確保してください。',
  uwQueueOpenCenter: '同期センターを開く',
  uwQueueCancel: '保存をキャンセル…',
  uwQueueCancelConfirm:
    'キュー内の保存をキャンセルしますか？変更はこのコンピューターに残り、UniWork のドキュメントは変わりません。',
  uwQueueCancelGo: '保存を取り消す',
  uwQueueCancelled: 'キュー内の保存をキャンセルしました。変更はこのコンピューターに残っています。',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: '再ログインが必要',
  uwReasonSignedOut: 'ログアウト済み',
  uwReasonForeign: '別のアカウントのもの',
  uwReasonArchived: 'ドキュメントはアーカイブ済み',
  uwReasonSuspended: '組織が停止中',
  uwReasonDeactivated: 'この組織であなたのアカウントは無効化されています',
  uwReasonLease: 'オフラインアクセスの期限切れ',
  uwReasonKeystore: 'このコンピューターのキーチェーンがロックされています',
  uwReasonClock: '時計が巻き戻されました',
  uwReasonStoreFull: 'このコンピューターの同期ストレージがいっぱい',
  uwReasonStoreNewer: '新しいバージョンのアプリが必要',

  // S2 queue-row badges
  uwBadgeQueued: '待機中',
  uwBadgeWaitNetwork: 'ネットワーク待ち',
  uwBadgePausedUser: '自分で一時停止',
  uwBadgePausedAdmin: '管理者が一時停止',
  uwBadgeSending: '送信中',
  uwBadgeReconciling: '確認中',
  uwBadgeReconcileStuck: 'サポートが必要',
  uwBadgeConflict: '競合',
  uwBadgeBlocked: 'ブロック済み',
  uwBadgeLocked: 'ロック中',
  uwBadgeRevoked: 'アクセス権なし',
  uwBadgeDeleted: '削除済み',
  uwBadgeReconnect: '再接続が必要',
  uwBadgeKeystore: 'キーチェーンがロック中',
  uwBadgeFailed: '送信できませんでした',
  uwBadgeSaved: '保存済み',
  uwBadgeKeptDraft: '保持された下書き',
  uwBadgeMoved: '移動済み',
  uwBadgeArchived: 'アーカイブ済み',

  // S2 queue-row details
  uwRowQueued: '{time} に保存 · バージョン {base} に基づく · {size}',
  uwRowWaitNetwork: 'オンラインになると送信します',
  uwRowPausedUser: '「送信を再開」を選ぶと送信します',
  uwRowPausedAdmin: '管理者が送信を再開すると送信します',
  uwRowUploading: 'アップロード中 {done} / {total}',
  uwRowCommitting: 'バージョンを作成中',
  uwRowReconciling: '{time} の送信結果はまだ不明です。UniWork に確認しています。',
  uwRowReconcileStuck:
    '確認の試行回数：{count}、まだ結果がありません。アプリは再送信しません。サポートコードを管理者に送ってください。',
  uwStuckDiscardConfirm:
    'この保存を破棄しますか？すでに UniWork に届いていればそのバージョンは残り、あなたのコピーは同期センターに下書きとして保持されます。',
  uwRowConflict: 'バージョン {n} は {author} が {time} に保存しました',
  uwRowFailed: '送信できませんでした：{reason}',
  uwRowBlocked: '保存できません：{reason}',
  uwRowCommitted: 'バージョン {n} · {time}',
  uwRowKeptDraft: '{time} の再読み込み時に保持',
  uwRowMoved: 'ドキュメントは {workspace} に移動しました',
  uwRowArchived: 'ドキュメントは UniWork でアーカイブされました',

  // S2 row actions
  uwActDiscard: '破棄',
  uwActDiscardSave: '保存を破棄…',
  uwActSendNow: '今すぐ送信',
  uwActRecheck: '再確認',
  uwActGuide: 'ガイド',
  uwActOpenToResolve: '開いて解決',
  uwActCopySupport: 'サポートコードをコピー',
  uwActDownloadMine: '自分のバージョンをダウンロード',
  uwActOpenDraft: '下書きを開く',
  uwActDiscardDraft: '下書きを破棄…',
  uwActSignInAgain: '再ログイン',
  uwActSignIn: 'ログイン',
  uwActSwitchAccount: 'アカウントを切り替え',
  uwActReconnect: '再接続',
  uwActDetails: '詳細',
  uwActOpen: '開く',
  uwDiscardDraftConfirm:
    'この下書きを破棄しますか？変更はこのコンピューターから削除され、元に戻せません。',

  // Sign-out prompt
  uwSignOutTitle: 'UniWork からログアウトしますか？',
  uwSignOutBody:
    '未保存の変更または保存待ちがあるドキュメント：{count}。これらはこのコンピューターにロックされたまま保持され、あなたのアカウントでのみ再び開けます。',
  uwSignOutKeystore:
    'コンピューターのキーチェーンがロックされているため、未保存の変更は開いているウィンドウにしかありません。今ログアウトするとそれらは破棄されます。すでに暗号化して保持されたものは残ります。残すには、先にコンピューターのロックを解除してください。',
  uwSignOutGo: 'ログアウト',
  uwSignOutWaiting: 'ログアウトする前に進行中の保存を完了しています…',

  // S2 sync center
  uwSyncTitle: '同期センター',
  uwSyncOpenFromSettings: '同期センター',
  uwSyncOnline: 'UniWork に接続済み · {time} に同期',
  uwSyncOffline: 'オフライン · 最終同期 {time}',
  uwSyncOnlineNoTime: 'UniWork に接続済み',
  uwSyncOfflineNoTime: 'オフライン',
  uwSyncPaused: '送信を一時停止中 — 新しい保存は待機します',
  uwSyncAdminPaused:
    '管理者が送信を一時停止しています。保存内容はこのコンピューターに保持されます。',
  uwSyncFeedOff:
    '新しいバージョンの通知は一時停止中です。保存時には UniWork が引き続き競合を確認します。',
  uwSyncResynced: '{time} に完全に再同期しました',
  uwSyncResyncFailed:
    '何度か試しましたが再同期できませんでした。新しいバージョンの通知は一時停止中です。保存時には UniWork が引き続き競合を確認します。',
  uwSyncSignedOut:
    'ログアウトしています。このコンピューターにロックして保持されている項目：{count}。',
  uwSyncSignedOutEmpty: 'ログアウトしています。',
  uwSyncSessionExpired:
    'セッションの有効期限が切れました。送信を続けるには再ログインしてください。',
  uwSyncOtherOrg: '別の組織で待機中の保存：{count}',
  uwSyncStoreBudget: 'このコンピューターの同期ストレージ：{used} / {cap}',
  uwSyncStoreError: 'このコンピューターのキューを読み取れませんでした。何も削除されていません。',
  uwSyncNow: '今すぐ同期',
  uwSyncPause: '送信を一時停止',
  uwSyncResume: '送信を再開',
  uwSyncNowOffline: '同期にはネットワーク接続が必要です。',
  uwSyncTabAttention: '要対応',
  uwSyncTabQueue: '保存待ち',
  uwSyncTabOffline: 'オフラインで利用可能',
  uwSyncTabRecent: '最近保存',
  uwSyncTabCount: '{label}：{count}',
  uwSyncColDoc: 'ドキュメント',
  uwSyncColState: '状態',
  uwSyncColDetail: '詳細',
  uwSyncColActions: '操作',
  uwSyncMoreActions: '{doc} のその他の操作',
  uwSyncEmptyQueue: '保存待ちのものはありません。',
  uwSyncEmptyAttention: '対応が必要なものはありません。',
  uwSyncEmptyRecent: '最近の保存はありません。',
  uwSyncActionFailed: '完了できませんでした。何も削除されていません。もう一度お試しください。',
  uwSyncRowAnnounce: '{doc}：{state}',

  // S3 offline library
  uwOfflinePin: 'オフラインで使用可能にする',
  uwOfflineUnpin: 'オフラインコピーを削除',
  uwOfflineUnpinShort: '固定を解除',
  uwOfflineAdd: 'ドキュメントを追加…',
  uwOfflineUsage: 'このコンピューターで {cap} 中 {used} を使用中',
  uwOfflineEmpty: 'オフラインで利用できるドキュメントはまだありません。',
  uwOfflineCapReached:
    'このコンピューターのオフラインライブラリは上限に達しています：容量 {cap}、最大ドキュメント数 {maxDocs}。別のものを追加するには、オフラインコピーを 1 つ削除してください。',
  uwOfflineReady: 'オフラインで利用可能',
  uwOfflineBadgeWaiting: 'ネットワーク待ち',
  uwOfflineBadgeDownloading: 'ダウンロード中',
  uwOfflineBadgeVerifying: '検証中',
  uwOfflineBadgeUpdate: '更新あり',
  uwOfflineBadgeInterrupted: '準備未完了',
  uwOfflineBadgeDiskFull: '空き容量不足',
  uwOfflineBadgeCorrupt: 'ダウンロードが破損',
  uwOfflineBadgeLeaseSoon: 'オフラインアクセスがまもなく終了',
  uwOfflineBadgeViewOnly: 'オフラインで利用可能 · 表示のみ',
  uwOfflineRowWaiting: 'オンラインになるとダウンロードします',
  uwOfflineRowProgress: '{done} / {total}',
  uwOfflineRowProgressAria: '{total} 中 {done}',
  uwOfflineRowVerifying: '整合性を確認中',
  uwOfflineRowReady: 'バージョン {n} · {size} · オフラインアクセス期限 {datetime}',
  uwOfflineRowUpdate:
    'バージョン {n} はオンラインになるとダウンロードされます。バージョン {old} は引き続き使えます',
  uwOfflineRowUpdateKept:
    'バージョン {n} に更新できませんでした：{reason}。バージョン {old} は引き続き使えます。',
  uwOfflineRowInterrupted:
    'ダウンロードが中断されました。古いコピー（ある場合）は引き続き使えます。',
  uwOfflineRowDiskFull: 'さらに {size} 必要です。古いコピーは保持されます。',
  uwOfflineRowCorrupt: '破損したコピーを削除しました。もう一度ダウンロードしてください。',
  uwOfflineRowLeaseSoon: '更新するには {datetime} までに接続してください',
  uwOfflineRowRevoked:
    'このドキュメントへのアクセス権がなくなりました。ダウンロードしたコピーは削除され、下書きはロックされたまま保持されます。',
  uwOfflineRowDeleted:
    'ドキュメントは UniWork で削除されました。ダウンロードしたコピーは削除され、下書きはロックされたまま保持されます。',
  uwOfflineRowArchived:
    'ドキュメントはアーカイブされました。このコピーはオフラインアクセスが終了するまで開けます。',
  uwOfflineRowMoved: '{workspace} に移動しました。このコピーは引き続き使えます。',
  uwOfflineRowViewOnly: 'バージョン {n} · 表示のみ · オフラインアクセス期限 {datetime}',
  uwOfflineReadyAnnounce: 'オフラインで利用可能：{doc}',
  uwOfflineUnpinConfirm:
    'ダウンロードしたコピーはこのコンピューターから削除されます。下書きと保存待ちは保持されます。',
  uwOfflineCancelDownload: 'ダウンロードをキャンセル',
  uwOfflineDownloadNow: '今すぐダウンロード',
  uwOfflineOpenFolder: '保存フォルダーを開く',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: '再接続が必要です',
  uwLockKeystoreTitle: 'このコンピューターのキーチェーンがロックされています',
  uwLockClockTitle: '時刻の確認が必要です',
  uwLockRevokedTitle: 'アクセス権がありません',
  uwLockDeletedTitle: 'ドキュメントは削除されました',
  uwLockForeignTitle: '別のアカウントのドキュメントです',
  uwLockOrgTitle: 'この組織では開けません',
  uwLockExpired:
    'オフラインアクセスの期限が切れました。内容は暗号化されたままです。もう一度開くには接続してください。',
  uwLockLibraryOff:
    '管理者がオフラインドキュメントを無効にしたため、オフラインアクセスを更新できません。下書きは同期センターでロックされたまま保持されます。',
  uwLockKeystore:
    'コンピューターのキーチェーンがロックされているため、暗号化された内容を開けません。ロックを解除してもう一度お試しください。何も削除されていません。',
  uwLockClock:
    'コンピューターの時計が巻き戻されたため、オフラインアクセスがロックされています。UniWork が時刻を確認できるよう接続してください。',
  uwLockForeign:
    'このドキュメントはこのコンピューター上の別のアカウントのものです。開くにはそのアカウントに切り替えてください。',
  uwLockSuspended: '組織が停止されています。内容は暗号化されたままです。管理者に連絡してください。',
  uwLockDeactivated:
    'この組織であなたのアカウントは無効化されています。内容は暗号化されたままです。管理者に連絡してください。',
  uwLockSignedOutTitle: 'ログアウトしています',
  uwLockSignedOut:
    '内容はこのコンピューターにロックされたまま保持されます。もう一度開くには同じアカウントでログインしてください。',
  uwLockRegion: 'ドキュメントの状態',
  uwLockWhileOpen:
    'ドキュメントは開いている間にロックされました。未保存の変更は暗号化して保持されます。ロックが解除されるまで保存やコピーはできません。',
  uwLockWhileOpenRam:
    'ドキュメントは開いている間にロックされ、このコンピューターはまだ変更を安全に保持できません。変更はこのウィンドウにのみ存在し（表示のみ）、閉じると失われます。',
  uwLockOtherWindow:
    'このドキュメントは別のウィンドウで編集用に開かれています。このウィンドウは表示のみです。',
  uwLockOtherWindowGone:
    'このドキュメントを編集していたウィンドウが応答しなくなりました。このウィンドウで編集できます。',
  uwLockGoToWindow: 'そのウィンドウに移動',
  uwLockTakeEdit: 'このウィンドウで編集',

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

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'このドキュメントは別の場所で変更されました',
  uwConflictBody: '変更はまだ UniWork になく、このコンピューターで安全に保持されています。',
  uwConflictReload: '最新版を再読み込み',
  uwConflictOverwrite: '上書き…',
  uwConflictCancel: 'キャンセル',
  uwConflictKeepUnavailable:
    'このコンピューターは現在下書きを保持できません（同期ストレージがいっぱい、またはキーチェーンがロック中）。',
  uwConflictOfflineDesktop:
    'オフラインで、最新バージョンがこのコンピューターにないため、まだ再読み込みできません。',
  uwConflictReloadDesktopBody: 'バージョン {n} を読み込む前に、変更をどうするか選んでください。',
  uwConflictKeepDraft: '自分のバージョンを下書きとして保持',
  uwConflictDiscard: '自分の変更を破棄',
  uwConflictKeepDraftHint:
    '下書きは同期センターに残り、表示やコピーができます。新しいバージョンに自動で適用されることはありません。',
  uwConflictDraftCapReached:
    'このドキュメントで保持できる下書きの上限に達しました：{cap}。別のものを保持するには、同期センターで古い下書きを破棄してください。',

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

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    '以前の保存にサポートが必要なため、まだ再読み込みも上書きもできません。同期センターを開いて解決してください。',
  uwRemoteRevoked:
    'このドキュメントへのアクセス権がなくなりました。保存は停止しました。未保存の変更はこのコンピューターにロックされたまま保持されます。',
} satisfies Record<keyof typeof zh, string>
