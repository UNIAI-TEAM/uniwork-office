import type { zh } from './zh'

export const zhTW = {
  aiWebClose: '關閉',
  aiWebStateCreditsTitle: 'AI 額度已用完',
  aiWebStateCreditsBody: '你的組織本期的 UniWork AI 額度已用完。請聯絡管理員或等待額度重設。',
  aiWebStateEntitlementTitle: '方案未包含 AI',
  aiWebStateEntitlementBody: '你的組織的 UniWork 方案不包含此 AI 功能。請聯絡管理員。',
  aiWebStateRateTitle: 'AI 請求過多',
  aiWebStateRateBody: '請等待 {seconds} 秒後再試。',
  aiWebStateRateBodyNow: '請稍後再試。',
  aiWebStateUnreachableTitle: '無法連線 AI 服務商',
  aiWebStateUnreachableBody: 'UniWork 無法連線到 AI 服務商。請稍後再試。',
  aiWebStateCloudTitle: '雲端工具無法使用',
  aiWebStateCloudBody: '伺服器尚未設定此 UniWork AI 工具。',
  aiWebStateOutageTitle: 'UniWork 暫時無法使用',
  aiWebStateOutageBody: '目前無法連線到 UniWork。請稍後再試。',
  aiWebStateSessionTitle: '工作階段已過期',
  aiWebStateSessionBody: '請從 UniWork 重新開啟文件以繼續。',
  aiWebStateRefusedTitle: '請求遭拒',
  aiWebStateRefusedBody: 'AI 請求遭伺服器拒絕。',
  aiWebStateUnknownTitle: 'AI 請求失敗',
  aiWebStateUnknownBody: '發生問題，請再試一次。',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge: '此活頁簿太大，無法在網頁上使用 AI。請在 UniWork Office 應用程式中開啟。',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: '繼續下一部分。',
} satisfies Record<keyof typeof zh, string>
