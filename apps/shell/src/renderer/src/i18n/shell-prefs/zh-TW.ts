import type { zh } from './zh'

export const zhTW = {
  setRestoreSession: '啟動時重新開啟上次的文件',
  setRestoreSessionDesc: '關閉 UniWork Office 時開啟的文件會在下次啟動時自動重新開啟。',
  setAutoUpdateCheck: '自動檢查更新',
  setAutoUpdateCheckDesc:
    '關閉後，啟動時與背景都不再檢查新版本；仍可在「說明 › 檢查更新」中手動檢查。',
} satisfies Record<keyof typeof zh, string>
