import type { zh } from './zh'

export const zhTW = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: '剩餘 {remaining} / {limit} 額度',
  aiUniworkFooterSignIn: '登入 UniWork 以使用 UniWork AI',
  aiUniworkSignedOut: '你已登出 UniWork。請選擇其他服務商或重新登入。',
  aiUniworkOff: '此文件已關閉 UniWork AI。請選擇其他服務商。',
  aiUniworkViewOnly: '僅檢視：AI 可以回答，但不能編輯或儲存文件。',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI 會讀取此文件中目前開啟的內容（包括未儲存的部分），並傳送給 UniWork 和模型服務商以產生回答。每次執行都會消耗 {org} 的 AI 額度。AI 不會替你儲存：請檢查後再按「儲存」。',
  aiUniworkDisclosureLabel: 'UniWork AI 會收到的內容',
  aiUniworkDisclosureShort: '將開啟的內容（包括未儲存部分）傳送到 UniWork · 使用 {org} 的額度',
  aiUniworkLocalFile:
    '此檔案在你的電腦上，不在 UniWork 中。使用 UniWork AI 時，開啟檔案的內容會傳送到 UniWork，並消耗 {org} 的 AI 額度。檔案不會作為 UniWork 文件上傳。',
  aiUniworkAck: '知道了',
  aiUniworkLearnMore: '了解詳情',
  aiUniworkDetails: '詳細資訊',
  aiUniworkSendNeedsAck: '傳送前請閱讀並確認此說明。',

  // S9 result chips and run controls
  aiResultAnswer: '回答',
  aiResultClarify: '需要釐清',
  aiResultEdited: '已在文件中編輯',
  aiResultUnsupported: '尚不支援',
  aiResultError: '錯誤',
  aiResultEditedHint: '尚未儲存 — 可用 Ctrl/⌘+Z 復原，確認無誤後按「儲存」。',
  aiResultViewChanges: '檢視變更',
  aiRunStop: '停止',
  aiRunSend: '傳送',
  aiRunRunning: '正在執行… 按「停止」或 Esc 停止。',
  aiRunStopped: '已停止。已套用的變更（如有）仍在文件中，可以復原。',
  aiRunAskAgain: '繼續提問',
  aiRunChooseOther: '選擇其他服務商',
  aiRunOpenInApp: '在應用程式中開啟',
  aiConversationRestarted:
    '之前的對話已過期，因此 UniWork AI 開始了新對話，不再記得之前的輪次。請重新傳送問題以繼續。',
  aiConversationBoundary: '與 {provider} 的新對話：上方的輪次不會一併傳送。',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit: '本次執行已達到 UniWork AI 的步驟上限。目前的結果會保留；請拆分請求後繼續提問。',
  aiErrCredits: '你的組織本週期的 AI 額度已用完。本次執行已停止。',
  aiErrEntitlement: '你的組織的方案已不再包含 UniWork AI。',
  aiErrRateLimited: '你傳送得太快了。請在 {seconds} 秒後重試。',
  aiErrRateLimitedNoWait: '你傳送得太快了。請幾分鐘後重試。',
  aiErrUnavailable: 'UniWork AI 暫時沒有回應。你的文件和「儲存」仍可正常使用。',
  aiErrDisconnected: '連線中斷，本次執行已停止。已套用的變更（如有）仍在文件中，可以復原。',
  aiErrOffline: '你已離線。UniWork AI 無法離線執行，請求也不會排隊。',
  aiErrSession: '你的 UniWork 登入已過期，本次執行已停止。請重新登入以繼續。',
  aiErrRevoked: '你已無權存取此文件，因此 AI 執行已停止。',
  aiErrDowngraded: '你的權限剛變為僅檢視，因此 AI 已停止編輯。回答會繼續。',
  aiErrCapabilityOff: '此文件的 UniWork AI 剛被關閉，因此本次執行在目前步驟後停止。',
  aiErrUnsupported: 'UniWork AI 暫時還無法在{module}中執行此操作。',
  aiErrViewOnlyEdit: '你對此文件只有檢視權限，因此 AI 無法編輯。',
} satisfies Record<keyof typeof zh, string>
