import type { zh } from './zh'

export const zhTW = {
  webConflictTitle: '此簡報已在其他地方被修改',
  webConflictBody:
    '有人儲存了較新的版本。覆寫會以你的變更取代它；重新載入會捨棄你的變更並開啟最新版本。',
  webConflictOverwrite: '覆寫',
  webConflictReload: '重新載入最新版本',
  webConflictNotSaved: '簡報已在其他地方被修改',
  webDiscardTitle: '捨棄未儲存的變更？',
  webDiscardBody: '此簡報有未儲存的變更。開啟其他檔案會遺失這些變更。',
  webDiscard: '捨棄並開啟',
  webCancel: '取消',
  webOk: '確定',
  webFatalTitle: '無法開啟此簡報',
  webFatalBody: '無法從 UniWork 載入檔案。請關閉此分頁後再試一次。',
  webNoHost: '此編輯器在 UniWork 中執行。請從 UniWork 開啟簡報。',
  webLegacyPpt: '這是舊版 .ppt 檔案，無法在瀏覽器中開啟。請先在 PowerPoint 中另存為 .pptx。',
  webEncryptedPptx: '此簡報受密碼保護，無法在瀏覽器中開啟。',
  webCommentAuthor: '使用者',
  webExternalMedia: '連結的外部媒體只能在桌面應用程式中播放。',
  webReadOnly: '此簡報為唯讀。',
  webSaveNetwork: '無法連線到 UniWork。請檢查網路後再試一次。',
  webSaveTimeout: '儲存耗時過長。請檢查網路後再試一次。',
  webFullscreenHint: '點擊或按任意鍵進入全螢幕',
} satisfies Record<keyof typeof zh, string>
