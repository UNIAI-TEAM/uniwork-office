import type { zh } from './zh'

export const zhTW = {
  collabMentionLabel: '提及某人',
  collabMentionSearching: '正在搜尋…',
  collabMentionCount: '結果：{count}',
  collabMentionNoMatch: '在有權檢視此文件的人中，沒有符合「{query}」的人。',
  collabMentionNoCandidates: '還沒有其他人可以檢視此文件。',
  collabMentionError: '無法載入人員清單。',
} satisfies Record<keyof typeof zh, string>
