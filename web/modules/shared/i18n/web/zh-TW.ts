import type { zh } from './zh'

export const zhTW = {
  webCancel: '取消',
  webConflictTitle: '此文件已在其他地方被修改',
  webConflictBody: '你的變更尚未存到 UniWork，會保留在此瀏覽器中，直到你登出。',
  webConflictOverwrite: '覆寫…',
  webConflictReload: '重新載入最新版本',
  webConflictNotSaved: '文件已在其他地方被修改',
  webFatalTitle: '無法開啟文件',
  webFatalBody: '編輯與儲存已停用。請重新整理頁面,或從 UniWork 重新開啟文件。',
  webNoHost: '此編輯器需在 UniWork 中執行。請從 UniWork 開啟文件。',
  webViewOnly: '僅檢視',
  webViewOnlyNotSaved: '此文件僅供檢視，無法儲存',
  webNotUtf8: '此檔案不是 UTF-8 文字，已以僅檢視方式開啟，以免儲存時變更其內容',
  webDraftTitle: '還原未儲存的變更？',
  webDraftBody: '此瀏覽器保留了此文件未儲存變更的副本。要還原還是捨棄這些變更？',
  webDraftOlder: '此副本以文件的舊版本為基礎。儲存後將取代較新的版本。',
  webDraftSavedAt: '副本保存於',
  webDraftKept: '此瀏覽器會保留該副本，直到你登出。',
  webDraftRestore: '還原',
  webDraftDiscard: '捨棄',
  webSaveNetwork: '無法連線到 UniWork。請檢查網路後再試一次。',
  webSaveTimeout: '儲存耗時過長。請檢查網路後再試一次。',
  webClose: '關閉',
  webSaveUnauthorized: '你的 UniWork 登入已失效。請重新登入後再儲存。',
  webSaveForbidden: '你沒有儲存此文件的權限。',
  webSaveNotFound: '此文件已不存在或已被移動。',
  webSaveTooLarge: '文件太大,無法儲存。',
  webSaveRateLimited: '請求過於頻繁。請稍候片刻後再試。',
  webSaveServer: 'UniWork 儲存時發生問題。請稍後再試。',
  webSaveFailedGeneric: '無法儲存文件。請再試一次。',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe: '你的變更尚未存到 UniWork，會保留在此瀏覽器中，直到你登出。',
  uwConflictReloadWebBody:
    '瀏覽器不會保留衝突草稿。請把你的版本下載到電腦以便日後複製，或捨棄你的變更。',
  uwConflictDownloadThenReload: '下載我的版本，然後重新載入',
  uwConflictDiscardThenReload: '捨棄變更並重新載入',
  uwConflictMineFileSuffix: '（我的版本）',
  uwConflictDownloadCheck: '瀏覽器已收到你的檔案。請確認檔案已儲存，然後選擇「重新載入」。',
  uwConflictSessionWeb:
    '登入工作階段已過期，因此沒有完成覆寫。你的變更仍保留在此瀏覽器中；請重新登入後重試。',
  uwConflictTooLarge: '你的版本超過了 UniWork 的大小限制，因此無法覆寫。',
  uwConflictDownloadTooLarge: '你的版本超過了 UniWork 的大小限制，因此無法在此下載。',
  uwConflictDownloadFailed: '無法下載你的版本，因此文件沒有重新載入。請重試。',
  uwConflictOfflineWeb: '離線中。在網頁上執行此操作需要網路連線；你的變更仍保留在瀏覽器中。',

  // S5 conflict dialog: two-column table
  uwConflictColMine: '你的版本',
  uwConflictColServer: 'UniWork 上的版本',
  uwConflictRowVersion: '版本',
  uwConflictRowTime: '時間',
  uwConflictRowBy: '儲存者',
  uwConflictMineUnsaved: '你（未儲存）',
  uwConflictBasedOn: '基於版本 {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: '檢視差異',
  uwConflictDiffPending: '正在比較…',
  uwConflictDiffFailed: '目前無法比較，請稍後再試。',
  uwConflictNoEdit: '你已無權編輯此文件。',
  uwConflictOverwriteTitle: '用你的版本覆寫？',
  uwConflictOverwriteConfirm:
    'UniWork 將根據你的副本建立版本 {next}。{author} 的版本 {server} 仍保留在歷史記錄中。',
  uwConflictOverwriteGo: '覆寫',
  uwConflictBack: '返回',
  uwConflictHeadMoved: '與此同時 UniWork 上已有版本 {n}。表格已更新；請重新選擇。',
  uwConflictReloadTitle: '重新載入最新版本',
  uwConflictReloadGo: '重新載入',
  uwConflictSaveCopy: '另存為副本…',
  uwConflictSaveCopyName: '{name}（副本）',
  uwConflictSaveCopyTitle: '另存為副本？',
  uwConflictSaveCopyConfirm:
    'UniWork 將根據你的版本建立一份新文件，擁有者和存取權限與此文件相同。目前的文件和 {author} 的版本 {server} 保持不變。',
  uwConflictSaveCopyGo: '建立副本',
  uwConflictSaveCopyDone:
    '你的版本已另存為新文件：{title}。此文件未改變；你仍可選擇重新載入或覆寫。',
  uwConflictSaveCopyFailed: '無法建立副本。你的變更仍然安全；請重試。',
  uwConflictSaveCopyOffline: '離線中。建立副本需要網路連線；你的變更會保留。',
  uwConflictReloadFailed: '無法載入最新版本。你的文件沒有改變；請重試。',
  uwConflictOverwriteFailed: '暫時無法覆寫。你的文件沒有改變；請重試。',
  uwConflictClose: '關閉',

  // S6 new-version bar
  uwRemoteRegion: '新版本',
  uwRemoteUpdated: '已更新到版本 {n}，由 {author} 於 {time} 儲存。',
  uwRemoteUpdatedNoRev: '已更新到 UniWork 上的最新版本。',
  uwRemoteNewerDirty:
    'UniWork 上有更新的版本（版本 {n}）。你有未儲存的變更，因此文件沒有自動重新載入。',
  uwRemoteNewerAi:
    'UniWork 上有更新的版本（版本 {n}）。UniWork AI 正在執行，因此文件沒有自動重新載入；AI 結果只套用於目前開啟的副本。',
  uwRemoteNowClean: '你已復原所有變更。UniWork 上的版本 {n} 比目前開啟的副本更新。',
  uwRemoteStopAiConfirm:
    '要停止正在執行的 UniWork AI 以重新載入嗎？AI 已做出的變更屬於目前開啟的副本。',
  uwRemoteWaitCommit: '正在等待傳送中的儲存完成；完成後即可重新載入。',
  uwRemoteReload: '重新載入最新版本…',
  uwRemoteLater: '稍後',
  uwRemoteClose: '關閉',
  uwRemoteReloadFailed: '無法載入版本 {n}。你仍在檢視之前的版本。',
  uwRemoteDeleted: '此文件已在 UniWork 中刪除。佇列中的儲存已停止。',
  uwAuthorFallback: '一位成員',
  uwLockRegion: '文件狀態',
  uwActRetry: '重試',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    '你已無權存取此文件。儲存已停止；未儲存的變更會保留在此瀏覽器中，直到你登出。',
  uwRemoteOrgBlockedWeb: '無法儲存：{reason}。未儲存的變更會保留在此瀏覽器中，直到你登出。',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: '文件已封存',
  uwReasonSuspended: '組織已被停權',
  uwReasonDeactivated: '你在此組織中的帳號已被停用',

  webSizeWarnChip: '即將達到 {max} 限制（目前 {size}）。',
  webSaveBlockTitle: '無法儲存到 UniWork',
  webSaveBlockBody:
    '此文件已超過 {max}。你的變更仍在目前頁面。請先將副本下載到電腦，再壓縮圖片或拆分文件。',
  webSaveBlockDownload: '下載我的副本',
  uwConflictTooLargeWithLimit:
    '你的版本已超過 {max}（目前 {size}）。請關閉此對話方塊以縮小檔案大小。',
  uwConflictTooLargeWithLimitDownload:
    '你的版本已超過 {max}（目前 {size}）。請關閉此對話方塊以縮小檔案大小，或選擇「重新載入最新版本」下載你的版本。',
  uwConflictSaveCopyTooLarge:
    '你的版本超過了 UniWork 的大小限制，因此無法建立副本。請關閉此對話方塊以縮小檔案大小。',
  uwConflictSaveCopyTooLargeDownload:
    '你的版本超過了 UniWork 的大小限制，因此無法建立副本。請關閉此對話方塊以縮小檔案大小，或選擇「重新載入最新版本」下載你的版本。',
  uwConflictSaveCopyTooLargeWithLimit:
    '你的版本已超過 {max}（目前 {size}），因此無法建立副本。請關閉此對話方塊以縮小檔案大小。',
  uwConflictSaveCopyTooLargeWithLimitDownload:
    '你的版本已超過 {max}（目前 {size}），因此無法建立副本。請關閉此對話方塊以縮小檔案大小，或選擇「重新載入最新版本」下載你的版本。',
} satisfies Record<keyof typeof zh, string>
