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

/**
 * Priority-ordered composer note kinds when UniWork AI is selected (EXPERIENCE › Composer note):
 * signed-out > capability/format off > not-entitled > subscription-inactive > credits-exhausted > unavailable.
 */
export type ComposerNoteKind =
  | 'signed-out'
  | 'off'
  | 'not-entitled'
  | 'subscription-inactive'
  | 'credits-exhausted'
  | 'unavailable'

export type ComposerNoteKey =
  | 'aiUniworkSignedOut'
  | 'aiUniworkOff'
  | 'not_entitled'
  | 'cloudInactiveBody'
  | 'credits_exhausted'
  | 'aiErrUnavailable'

export type ComposerNoteAction = 'sign-in' | 'choose-provider'

export interface ComposerNoteInput {
  /** Whether UniWork AI (`uniwork`) is the currently selected provider */
  readonly uniworkSelected?: boolean | undefined
  /** Optional provider id; treated as selected when `'uniwork'` and `uniworkSelected` is omitted */
  readonly provider?: string | undefined
  /** Current UniWork cloud state */
  readonly cloudState?: UniworkCloudState | null | undefined
  /** Explicit signed-out override (for tie resolution tests or pre-cloud-read session state) */
  readonly signedOut?: boolean | undefined
  /** Organization capability `ai_uniwork` enabled (default true) */
  readonly capabilityOn?: boolean | undefined
  /** Open document format in `ai_uniwork_formats` (default true) */
  readonly formatOn?: boolean | undefined
  /** `tools.chat` flag from `GET /orgs/{orgID}/ai/cloud` (default true) */
  readonly toolsChat?: boolean | undefined
  /** Explicit capability/format off override */
  readonly off?: boolean | undefined
  /** Explicit not-entitled override (for priority tie resolution) */
  readonly notEntitled?: boolean | undefined
  /** Explicit subscription-inactive override (for priority tie resolution) */
  readonly subscriptionInactive?: boolean | undefined
  /** Explicit credits-exhausted override (for priority tie resolution) */
  readonly creditsExhausted?: boolean | undefined
  /** Explicit unavailable override (for priority tie resolution) */
  readonly unavailable?: boolean | undefined
  /** View-only document mode (renders a separate sub-line under the composer; never suppresses the note) */
  readonly viewOnly?: boolean | undefined
  /** UI locale (`'vi'`, `'en'`, …) */
  readonly locale?: string | undefined
}

export interface ComposerNote {
  readonly kind: ComposerNoteKind
  readonly key: ComposerNoteKey
  readonly action: ComposerNoteAction
  readonly text?: string | undefined
}

/**
 * Resolves the single composer note shown above the composer when UniWork AI is selected.
 * Returns `null` when UniWork AI is not selected or is ready with capability and format enabled.
 */
export function composerNoteFor(input: ComposerNoteInput): ComposerNote | null {
  const selected = input.uniworkSelected ?? input.provider === 'uniwork'
  if (!selected) return null
  if (input.signedOut === true || input.cloudState === 'signed-out') {
    return { kind: 'signed-out', key: 'aiUniworkSignedOut', action: 'sign-in' }
  }
  if (
    input.off === true ||
    input.capabilityOn === false ||
    input.formatOn === false ||
    input.toolsChat === false
  ) {
    return { kind: 'off', key: 'aiUniworkOff', action: 'choose-provider' }
  }
  if (input.notEntitled === true || input.cloudState === 'not-entitled') {
    return { kind: 'not-entitled', key: 'not_entitled', action: 'choose-provider' }
  }
  if (input.subscriptionInactive === true || input.cloudState === 'subscription-inactive') {
    return {
      kind: 'subscription-inactive',
      key: 'cloudInactiveBody',
      action: 'choose-provider',
    }
  }
  if (input.creditsExhausted === true || input.cloudState === 'credits-exhausted') {
    return { kind: 'credits-exhausted', key: 'credits_exhausted', action: 'choose-provider' }
  }
  if (input.unavailable === true || input.cloudState === 'unavailable') {
    return { kind: 'unavailable', key: 'aiErrUnavailable', action: 'choose-provider' }
  }
  return null
}
