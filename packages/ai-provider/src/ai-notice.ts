import type { UniworkCloudState } from './uniwork-cloud'

/**
 * Product notices for a UniWork AI plan state: the organization's plan has no UniWork AI, or its
 * credits ran out for the period. The text never mentions an account of this app or a purchase
 * inside it: plans belong to the organization, so the way out is an organization admin.
 * en and vi are ours.
 */
export type AiNoticeKind = 'not_entitled' | 'credits_exhausted'

export type AiNoticeLang = 'en' | 'vi'

const AI_NOTICE_TEXT: Record<AiNoticeLang, Record<AiNoticeKind, string>> = {
  en: {
    not_entitled:
      "Your organization's plan does not include UniWork AI. Ask an organization admin about the plan.",
    credits_exhausted:
      'Your organization has used all its AI credits for this period. Ask an organization admin to add credits.',
  },
  vi: {
    not_entitled:
      'Gói của tổ chức bạn chưa bao gồm UniWork AI. Hãy liên hệ quản trị viên tổ chức về gói.',
    credits_exhausted:
      'Tổ chức của bạn đã dùng hết tín dụng AI trong kỳ này. Hãy nhờ quản trị viên tổ chức bổ sung.',
  },
}

/** the notice text for one language; only en and vi are ours */
export function aiNoticeText(kind: AiNoticeKind, lang: AiNoticeLang): string {
  return AI_NOTICE_TEXT[lang][kind]
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

/** the one action a composer note offers; a plan or availability note has none */
export type ComposerNoteAction = 'sign-in'

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
  /** null: the note only informs (UniWork AI is the one provider, so there is nothing to switch to) */
  readonly action: ComposerNoteAction | null
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
    return { kind: 'off', key: 'aiUniworkOff', action: null }
  }
  if (input.notEntitled === true || input.cloudState === 'not-entitled') {
    return { kind: 'not-entitled', key: 'not_entitled', action: null }
  }
  if (input.subscriptionInactive === true || input.cloudState === 'subscription-inactive') {
    return {
      kind: 'subscription-inactive',
      key: 'cloudInactiveBody',
      action: null,
    }
  }
  if (input.creditsExhausted === true || input.cloudState === 'credits-exhausted') {
    return { kind: 'credits-exhausted', key: 'credits_exhausted', action: null }
  }
  if (input.unavailable === true || input.cloudState === 'unavailable') {
    return { kind: 'unavailable', key: 'aiErrUnavailable', action: null }
  }
  return null
}
