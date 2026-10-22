import type { zh } from './zh'

export const zhTW = {
  algMenu: '存取記錄',
  algTitle: '存取記錄',
  algDescription: '誰檢視、下載或透過連結開啟了此文件。只有管理者可以查看。',
  algManageOnly: '你需要管理權限才能查看存取記錄。',
  algLoading: '正在載入記錄…',
  algError: '無法載入存取記錄。',
  algEmpty: '尚無存取記錄。',
  algFilterLabel: '操作',
  algFilterAll: '所有操作',
  algActionView: '檢視',
  algActionDownload: '下載',
  algActionExport: '匯出',
  algActionLinkView: '透過連結開啟',
  algActionUnknown: '其他',
  algActorAnonymous: '匿名',
  algActorSystem: '系統',
  algActorUnknown: '未知',
  algVersion: '版本 {no}',
} satisfies Record<keyof typeof zh, string>
