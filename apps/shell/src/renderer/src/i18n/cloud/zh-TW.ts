import type { zh } from './zh'

export const zhTW = {
  cloudTitle: 'UniWork 雲端 AI',
  cloudStateReady: '可用',
  cloudStateNotEntitled: '方案未包含此功能',
  cloudStateExhausted: 'AI 額度已用完',
  cloudStateUnavailable: '暫時無法使用',
  cloudStateInactive: '訂閱未生效',
  cloudCredits: 'AI 額度',
  cloudCreditsLeft: '剩餘 {remaining} / {limit}',
  cloudCreditsUnlimited: '不限量',
  cloudCreditsRenews: '{date} 重置',
  cloudToolsToggle: '使用 UniWork 雲端工具',
  cloudToolsToggleDesc:
    '網頁搜尋、圖片生成和媒體分析改用 UniWork 雲端（消耗 AI 額度）。',
} satisfies Record<keyof typeof zh, string>
