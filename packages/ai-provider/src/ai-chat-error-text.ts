import { aiNoticeText } from './ai-notice'
import type { AiTestFailureKind } from './ai-test-failure'

/**
 * Product messages for a failed AI chat turn (panel chat, one-click actions,
 * email AI). The raw service text ("HTTP 401: {"error": ...}") belongs in the
 * main process log; what the user reads is one sentence per failure kind, in
 * their language. The plan states reuse the notice texts of `ai-notice.ts`.
 * AI runs on UniWork AI only, so no text points at an AI key or at model
 * settings. en and vi are ours, any other locale reads the English text.
 */
type TextLang = 'en' | 'vi'

const CHAT_FAILURE_TEXT: Record<TextLang, Record<AiTestFailureKind, string>> = {
  en: {
    not_entitled: aiNoticeText('not_entitled', 'en'),
    credits_exhausted: aiNoticeText('credits_exhausted', 'en'),
    invalid_key: 'The AI service did not accept your sign-in. Sign in to UniWork again, then try again.',
    network: 'Can’t reach the AI service. Check your connection and try again.',
    limit: 'The AI service’s limit was reached. Try again later.',
    unavailable: 'The AI service is not answering right now. Try again in a moment.',
    misconfigured: 'The AI service could not take this request. Try again later.',
    failed: 'The AI request failed. Try again.',
  },
  vi: {
    not_entitled: aiNoticeText('not_entitled', 'vi'),
    credits_exhausted: aiNoticeText('credits_exhausted', 'vi'),
    invalid_key:
      'Dịch vụ AI không chấp nhận phiên đăng nhập của bạn. Hãy đăng nhập lại UniWork rồi thử lại.',
    network: 'Không kết nối được tới dịch vụ AI. Hãy kiểm tra kết nối mạng rồi thử lại.',
    limit: 'Đã chạm giới hạn của dịch vụ AI. Hãy thử lại sau.',
    unavailable: 'Dịch vụ AI hiện chưa phản hồi. Hãy thử lại sau ít phút.',
    misconfigured: 'Dịch vụ AI chưa nhận được yêu cầu này. Hãy thử lại sau.',
    failed: 'Yêu cầu AI không thành công. Hãy thử lại.',
  },
}

/** the message for one failure kind in the UI language (English for any language but vi) */
export function aiChatFailureText(kind: AiTestFailureKind, lang: string): string {
  return CHAT_FAILURE_TEXT[lang === 'vi' ? 'vi' : 'en'][kind]
}
