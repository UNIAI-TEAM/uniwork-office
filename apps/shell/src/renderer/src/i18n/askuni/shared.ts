import type { Lang } from '@genoffice/i18n'
import { askUniUiStrings } from '@genoffice/ui'

/**
 * The Ask UNI copy the shared core (packages/ui) owns and the Home pane uses through it: the answer,
 * notices, steps, citations and actions of the v2 thread. The values are the ui shard's, so Home and
 * the editors always say the same thing; the shell shards of zh, en and vi spread them in.
 */
export const SHARED_ASKUNI_KEYS = [
  'askUniV2NoticeStopped',
  'askUniV2NoticeInterrupted',
  'askUniV2NoticeAgentFailed',
  'askUniV2NoticeEmptyAnswer',
  'askUniV2ErrProviderError',
  'askUniV2ErrProviderTimeout',
  'askUniV2ErrOutputInvalid',
  'askUniV2ErrToolNotAllowed',
  'askUniV2ErrRefused',
  'askUniV2ErrCancelled',
  'askUniV2ErrStreamEnded',
  'askUniV2AnswerReady',
  'askUniV2Retry',
  'askUniV2StepsSeen',
  'askUniV2StepTaskOne',
  'askUniV2StepTaskMany',
  'askUniV2StepMeetingOne',
  'askUniV2StepMeetingMany',
  'askUniV2StepDocumentOne',
  'askUniV2StepDocumentMany',
  'askUniV2StepProjectOne',
  'askUniV2StepProjectMany',
  'askUniV2StepChatOne',
  'askUniV2StepChatMany',
  'askUniV2CiteLabel',
  'askUniV2CiteOpen',
  'askUniV2Copy',
  'askUniV2Copied',
  'askUniV2Regenerate',
  'askUniV2Helpful',
  'askUniV2NotRight',
  'askUniV2FeedbackTitle',
  'askUniV2ReasonWrongFacts',
  'askUniV2ReasonMissingSources',
  'askUniV2ReasonNotHelpful',
  'askUniV2ReasonOther',
  'askUniV2NoteLabel',
  'askUniV2NotePlaceholder',
  'askUniV2NoteCount',
  'askUniV2SendFeedback',
] as const

export type SharedAskUniKey = (typeof SHARED_ASKUNI_KEYS)[number]

export function sharedAskUni(lang: Lang): Record<SharedAskUniKey, string> {
  const dict = askUniUiStrings[lang] as Record<string, string>
  return Object.fromEntries(SHARED_ASKUNI_KEYS.map((k) => [k, dict[k]!])) as Record<
    SharedAskUniKey,
    string
  >
}
