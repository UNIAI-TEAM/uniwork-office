import { getUniworkCloudStatus, type UniworkCloudState } from './uniwork-cloud'

/**
 * Product notices for "chat has no model to talk to". Chat and the one-click AI
 * actions run on the user's own AI key (the UniWork cloud only serves search,
 * images, media analysis and transcription), so a missing key is a setup state,
 * not a failure and not a purchase. The text depends on what the organization
 * plan says about cloud AI, but never mentions an account of this app or a
 * purchase inside it: plans belong to the organization.
 *
 * The main process picks the notice text and tags it with a code (`[[ai-notice:<kind>]]`
 * in front of the text); renderers read the code back with `aiNoticeKind`, draw the
 * message without the tag (`aiNoticeBody`) as a notice with an "open settings"
 * action instead of a red error line. The code, not the wording, marks a notice, so
 * every UI language gets it. The exact en/vi texts are still recognized untagged.
 */
export type AiNoticeKind = 'no_model' | 'not_entitled' | 'credits_exhausted'

export type AiNoticeLang = 'en' | 'vi'

const AI_NOTICE_TEXT: Record<AiNoticeLang, Record<AiNoticeKind, string>> = {
  en: {
    no_model:
      'No AI model is set up yet. Add your own AI key in Settings > AI Model to use the assistant.',
    not_entitled:
      "Your organization's plan does not include UniWork AI. Ask an organization admin about the plan, or add your own AI key in Settings > AI Model.",
    credits_exhausted:
      'Your organization has used all its AI credits for this period. Ask an organization admin to add credits, or add your own AI key in Settings > AI Model.',
  },
  vi: {
    no_model:
      'Chưa thiết lập mô hình AI. Hãy thêm khóa AI của riêng bạn trong Cài đặt > Mô hình AI để dùng Trợ lý AI.',
    not_entitled:
      'Gói của tổ chức bạn chưa bao gồm UniWork AI. Hãy liên hệ quản trị viên tổ chức về gói, hoặc thêm khóa AI của riêng bạn trong Cài đặt > Mô hình AI.',
    credits_exhausted:
      'Tổ chức của bạn đã dùng hết tín dụng AI trong kỳ này. Hãy nhờ quản trị viên tổ chức bổ sung, hoặc thêm khóa AI của riêng bạn trong Cài đặt > Mô hình AI.',
  },
}

const NOTICE_KINDS: readonly AiNoticeKind[] = ['no_model', 'not_entitled', 'credits_exhausted']

const CODE_PREFIX = '[[ai-notice:'
const CODE_PATTERN = /^\[\[ai-notice:(no_model|not_entitled|credits_exhausted)\]\]\s*/

/** a notice text tagged with its code (the form the main process sends) */
export function aiNoticeTagged(kind: AiNoticeKind, text: string): string {
  return `${CODE_PREFIX}${kind}]] ${text}`
}

/** the message as the user reads it: without the notice code */
export function aiNoticeBody(message: string): string {
  return message.replace(CODE_PATTERN, '')
}

/** the notice text for one language; only en and vi are ours */
export function aiNoticeText(kind: AiNoticeKind, lang: AiNoticeLang): string {
  return AI_NOTICE_TEXT[lang][kind]
}

/** which notice a message is (its code, or the exact en/vi text), or null for a real error */
export function aiNoticeKind(message: string | null | undefined): AiNoticeKind | null {
  const text = message?.trim()
  if (!text) return null
  const tagged = CODE_PATTERN.exec(text)
  if (tagged) return tagged[1] as AiNoticeKind
  for (const lang of Object.keys(AI_NOTICE_TEXT) as AiNoticeLang[]) {
    for (const kind of NOTICE_KINDS) {
      if (AI_NOTICE_TEXT[lang][kind] === text) return kind
    }
  }
  return null
}

/** what the cloud state says about why there is nothing to chat with */
export function aiNoticeKindForCloud(state: UniworkCloudState): AiNoticeKind {
  switch (state) {
    case 'not-entitled':
    case 'subscription-inactive':
      return 'not_entitled'
    case 'credits-exhausted':
      return 'credits_exhausted'
    default:
      return 'no_model'
  }
}

/**
 * The message for a chat request that has no key, tagged as a notice in every
 * language. en and vi get the state-aware notice in their language; other locales
 * keep their own neutral "no API key configured" text for the plain no-model case
 * and fall back to the English notice for the plan states.
 */
export function noModelMessageFor(
  lang: string,
  cloudState: UniworkCloudState,
  fallback: string,
): string {
  const kind = aiNoticeKindForCloud(cloudState)
  if (lang === 'en' || lang === 'vi') return aiNoticeTagged(kind, aiNoticeText(kind, lang))
  return aiNoticeTagged(kind, kind === 'no_model' ? fallback : aiNoticeText(kind, 'en'))
}

/** `noModelMessageFor` with the cloud state this process currently holds (the shell main process keeps it live) */
export function noModelMessage(lang: string, fallback: string): string {
  return noModelMessageFor(lang, getUniworkCloudStatus().state, fallback)
}
