import { aiNoticeText } from './ai-notice'
import type { AiTestFailureKind } from './ai-test-failure'

/**
 * Product messages for a failed AI chat turn (panel chat, one-click actions,
 * email AI). The raw provider text ("HTTP 401: {"error": ...}") belongs in the
 * main process log; what the user reads is one sentence per failure kind, in
 * their language. The kinds are the ones the Settings "Test" pills use
 * (`ai-test-failure.ts`); the plan states reuse the notice texts of
 * `ai-notice.ts`. en and vi are ours, any other locale reads the English text
 * (the same rule as `noModelMessageFor`).
 */
type TextLang = 'en' | 'vi'

const CHAT_FAILURE_TEXT: Record<TextLang, Record<AiTestFailureKind, string>> = {
  en: {
    not_entitled: aiNoticeText('not_entitled', 'en'),
    credits_exhausted: aiNoticeText('credits_exhausted', 'en'),
    invalid_key:
      'The AI key is missing or was rejected by the provider. Check it in Settings > AI Model.',
    network: 'Can’t reach the AI service. Check your connection and try again.',
    limit:
      'The AI provider’s limit was reached (rate limit or no credits left). Try again later or check your provider account.',
    unavailable: 'The AI service is not answering right now. Try again in a moment.',
    misconfigured:
      'The AI settings are incomplete. Check the service address and account fields in Settings > AI Model.',
    failed:
      'The AI request failed. Check the provider, model and address in Settings > AI Model, then try again.',
  },
  vi: {
    not_entitled: aiNoticeText('not_entitled', 'vi'),
    credits_exhausted: aiNoticeText('credits_exhausted', 'vi'),
    invalid_key:
      'Khóa AI bị thiếu hoặc bị nhà cung cấp từ chối. Hãy kiểm tra trong Cài đặt > Mô hình AI.',
    network: 'Không kết nối được tới dịch vụ AI. Hãy kiểm tra kết nối mạng rồi thử lại.',
    limit:
      'Đã chạm giới hạn của nhà cung cấp AI (giới hạn tốc độ hoặc hết tín dụng). Hãy thử lại sau hoặc kiểm tra tài khoản nhà cung cấp.',
    unavailable: 'Dịch vụ AI hiện chưa phản hồi. Hãy thử lại sau ít phút.',
    misconfigured:
      'Cài đặt AI chưa đầy đủ. Hãy kiểm tra địa chỉ dịch vụ và các trường tài khoản trong Cài đặt > Mô hình AI.',
    failed:
      'Yêu cầu AI không thành công. Hãy kiểm tra nhà cung cấp, mô hình và địa chỉ trong Cài đặt > Mô hình AI rồi thử lại.',
  },
}

/** the message for one failure kind in the UI language (English for any language but vi) */
export function aiChatFailureText(kind: AiTestFailureKind, lang: string): string {
  return CHAT_FAILURE_TEXT[lang === 'vi' ? 'vi' : 'en'][kind]
}
