import type { zh } from './zh'

export const en = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: '{remaining} / {limit} left',
  aiUniworkFooterSignIn: 'Sign in to UniWork to use UniWork AI',
  aiUniworkSignedOut: 'You’re signed out of UniWork. Choose another provider or sign in again.',
  aiUniworkOff: 'UniWork AI is off for this document. Choose another provider.',
  aiUniworkViewOnly: 'View only: AI can answer but can’t edit or save the document.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI reads what’s open in this document, including unsaved changes, and sends it to UniWork and the model provider to answer. Each run uses {org}’s AI credits. AI never saves for you: review, then press Save.',
  aiUniworkDisclosureLabel: 'What UniWork AI receives',
  aiUniworkDisclosureShort: 'Sends open content (including unsaved) to UniWork · {org} credits',
  aiUniworkLocalFile:
    'This file is on your computer, not in UniWork. With UniWork AI, the open file’s content is sent to UniWork and uses {org}’s AI credits. The file isn’t uploaded as a UniWork document.',
  aiUniworkAck: 'Got it',
  aiUniworkLearnMore: 'Learn more',
  aiUniworkDetails: 'Details',
  aiUniworkSendNeedsAck: 'Read and confirm the notice before sending.',

  // S9 result chips and run controls
  aiResultAnswer: 'Answer',
  aiResultClarify: 'Needs clarification',
  aiResultEdited: 'Edited in document',
  aiResultUnsupported: 'Not supported',
  aiResultError: 'Error',
  aiResultEditedHint: 'Not saved — undo with Ctrl/⌘+Z, or press Save when it looks right.',
  aiResultViewChanges: 'View changes',
  aiRunStop: 'Stop',
  aiRunSend: 'Send',
  aiRunRunning: 'Running… Press Stop or Esc to stop.',
  aiRunStopped: 'Stopped. Any changes already applied stay in the document and can be undone.',
  aiRunAskAgain: 'Ask again',
  aiRunChooseOther: 'Choose another provider',
  aiRunOpenInApp: 'Open in the app',
  aiConversationRestarted:
    'The previous conversation expired, so UniWork AI started a new one and no longer remembers earlier turns. Send your question again to continue.',
  aiConversationBoundary: 'New conversation with {provider}: the turns above aren’t sent along.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'This run reached UniWork AI’s step limit. Results so far are kept; split the request and ask again.',
  aiErrCredits: 'Your organization is out of AI credits for this period. This run stopped.',
  aiErrEntitlement: 'Your organization’s plan no longer includes UniWork AI.',
  aiErrRateLimited: 'You’re sending too fast. Try again in {seconds} s.',
  aiErrRateLimitedNoWait: 'You’re sending too fast. Try again in a few minutes.',
  aiErrUnavailable: 'UniWork AI isn’t responding right now. Your document and Save still work.',
  aiErrGeneric:
    'UniWork AI ran into an unexpected problem, so this run stopped. Your document and Save still work.',
  aiErrDisconnected:
    'The connection dropped, so this run stopped. Any changes already applied stay in the document and can be undone.',
  aiErrOffline: 'You’re offline. UniWork AI doesn’t run offline and requests aren’t queued.',
  aiErrSession: 'Your UniWork session expired, so this run stopped. Sign in again to continue.',
  aiErrRevoked: 'You no longer have access to this document, so the AI run stopped.',
  aiErrDowngraded:
    'Your access just changed to view only, so AI stopped editing. Answers continue.',
  aiErrCapabilityOff:
    'UniWork AI was just turned off for this document, so the run stopped after its current step.',
  aiErrUnsupported: 'UniWork AI can’t do this in {module} yet.',
  aiErrViewOnlyEdit: 'You only have view access to this document, so AI can’t edit it.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'Your request is too long for UniWork AI. Shorten it to under 8,000 characters and send again.',
  aiErrQuestionRejected: 'UniWork AI couldn’t accept this request. Change it, then send it again.',
  aiUniworkImagesNotSent: 'Images aren’t sent to UniWork AI; only your text was sent.',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
  cloudStateReady: 'Available',
  cloudStateNotEntitled: 'Not in your plan',
  cloudStateExhausted: 'Out of AI credits',
  cloudStateUnavailable: 'Unavailable',
  cloudStateSignedOut: 'Not signed in',
  cloudStateInactive: 'Subscription inactive',
  cloudCredits: 'AI credits',
  cloudCreditsLeft: '{remaining} / {limit} left',
  cloudCreditsUnlimited: 'Unlimited',
  cloudCreditsRenews: 'Renews {date}',
  cloudInactiveBody:
    'Your organization’s UniWork subscription is not active, so cloud AI is paused. Ask an admin to renew it; your own providers below keep working.',
  acctSignIn: 'Sign in',
  acctSignInAgain: 'Sign in again',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart:
    'Local files start a new conversation under your organization and don’t keep turns from other files.',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta:
    'Cells written: {written} ({range}) · Existing cells overwritten: {overwritten}',
  aiResultCellsMetaNoOverwrite: 'Cells written: {written} ({range})',
  aiErrWorkbookTooLarge:
    'This workbook is too large for AI on the web. Open it in the UniWork Office app.',
  // S7 composer notice keys (not_entitled, credits_exhausted)
  not_entitled:
    "Your organization's plan does not include UniWork AI. Ask an organization admin about the plan, or add your own AI key in Settings > AI Model.",
  credits_exhausted:
    'Your organization has used all its AI credits for this period. Ask an organization admin to add credits, or add your own AI key in Settings > AI Model.',
} satisfies Record<keyof typeof zh, string>
