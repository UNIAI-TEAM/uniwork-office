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
  cloudSignedOutBody: '登入 UniWork 後，可使用由組織 AI 額度支付的網頁搜尋、圖片生成和媒體分析。',
  cloudNotEntitledBody: '你所在組織的方案未包含 UniWork 雲端 AI。你仍可使用下方自己的服務商。',
  cloudExhaustedBody:
    '你所在組織本週期的 UniWork AI 額度已用完。雲端工具會暫停到額度重置；下方自己的服務商不受影響。',
  cloudUnavailableBody: 'UniWork 雲端 AI 暫時無法使用。下方自己的服務商不受影響。',
  cloudInactiveBody:
    '你所在組織的 UniWork 訂閱未生效，雲端 AI 已暫停。請聯絡管理員續訂；下方自己的服務商不受影響。',
  cloudToolsOffBody:
    'UniWork 雲端工具已關閉。請在「{section}」中開啟「{switch}」以使用組織的 AI 額度；下方自己的服務商不受影響。',
  cloudReadyBody: '未設定自有服務商時，搜尋、圖片生成和媒體分析會使用組織的 UniWork AI 額度。',
  cloudToolsToggle: '使用 UniWork 雲端工具',
  cloudToolsToggleDesc:
    '未設定自有服務商時，網頁搜尋、圖片生成和媒體分析改用 UniWork 雲端（消耗 AI 額度）。',
  cloudMediaLabel: 'UniWork 雲端',
  cloudMediaDesc: '使用組織的 UniWork AI 額度，無需金鑰。',
  cloudSearchAutoHint: '先用 UniWork 雲端（消耗 AI 額度），再用免費搜尋。',
} satisfies Record<keyof typeof zh, string>
