import type { zh } from './zh'

export const zhTW = {
  webCancel: '取消',
  webConflictTitle: '此文件已在其他地方被修改',
  webConflictBody:
    '在你編輯期間已儲存了較新的版本。要用你的版本覆寫它,還是重新載入最新版本並捨棄你的變更?',
  webConflictOverwrite: '覆寫',
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
} satisfies Record<keyof typeof zh, string>
