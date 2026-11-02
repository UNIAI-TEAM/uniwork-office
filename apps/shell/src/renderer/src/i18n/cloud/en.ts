import type { zh } from './zh'

export const en = {
  cloudTitle: 'UniWork cloud AI',
  cloudStateReady: 'Available',
  cloudStateNotEntitled: 'Not in your plan',
  cloudStateExhausted: 'Out of AI credits',
  cloudStateUnavailable: 'Unavailable',
  cloudStateInactive: 'Subscription inactive',
  cloudCredits: 'AI credits',
  cloudCreditsLeft: '{remaining} / {limit} left',
  cloudCreditsUnlimited: 'Unlimited',
  cloudCreditsRenews: 'Renews {date}',
  cloudToolsToggle: 'Use UniWork cloud tools',
  cloudToolsToggleDesc:
    'Web search, image generation and media analysis use UniWork cloud (spends AI credits).',
} satisfies Record<keyof typeof zh, string>
