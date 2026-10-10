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
  webViewOnly: '僅供檢視',
  webReloaded: '已重新載入最新版本,你的變更已捨棄',
  webViewOnlyNoSave: '此文件僅供檢視',
  webMergeTitle: '合併 PDF',
  webMergeBody: '已選擇 {count} 個 PDF。繼續新增 PDF 還是立即合併?',
  webMergeAdd: '再新增一個 PDF',
  webMergeNow: '立即合併',
  webSaveNetwork: '無法連線到 UniWork。請檢查網路後再試一次。',
  webSaveTimeout: '儲存耗時過長。請檢查網路後再試一次。',
} satisfies Record<keyof typeof zh, string>
