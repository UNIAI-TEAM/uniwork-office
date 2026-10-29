import type { zh } from './zh'

export const en = {
  aiWebClose: 'Close',
  aiWebStateCreditsTitle: 'AI credits used up',
  aiWebStateCreditsBody:
    'Your organization has used all UniWork AI credits for this period. Ask your administrator, or wait until they renew.',
  aiWebStateEntitlementTitle: 'AI is not in your plan',
  aiWebStateEntitlementBody:
    "Your organization's UniWork plan does not include this AI feature. Ask your administrator.",
  aiWebStateRateTitle: 'Too many AI requests',
  aiWebStateRateBody: 'Wait {seconds} s and try again.',
  aiWebStateRateBodyNow: 'Wait a moment and try again.',
  aiWebStateUnreachableTitle: 'AI provider unreachable',
  aiWebStateUnreachableBody: 'UniWork could not reach the AI provider. Try again in a moment.',
  aiWebStateCloudTitle: 'Cloud tool unavailable',
  aiWebStateCloudBody: 'This UniWork AI tool is not set up on the server yet.',
  aiWebStateOutageTitle: 'UniWork is temporarily unavailable',
  aiWebStateOutageBody: 'UniWork could not be reached right now. Try again in a moment.',
  aiWebStateSessionTitle: 'Session expired',
  aiWebStateSessionBody: 'Reopen the document from UniWork to continue.',
  aiWebStateRefusedTitle: 'Request refused',
  aiWebStateRefusedBody: 'The server refused the AI request.',
  aiWebStateUnknownTitle: 'AI request failed',
  aiWebStateUnknownBody: 'Something went wrong. Try again.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'This workbook is too large for AI on the web. Open it in the UniWork Office app.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Continue with the next part.',
} satisfies Record<keyof typeof zh, string>
