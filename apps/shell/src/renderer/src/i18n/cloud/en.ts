import type { zh } from './zh'

export const en = {
  cloudTitle: 'UniWork cloud AI',
  cloudStatus: 'Status',
  cloudStateReady: 'Available',
  cloudStateNotEntitled: 'Not in your plan',
  cloudStateExhausted: 'Out of AI credits',
  cloudStateUnavailable: 'Unavailable',
  cloudCredits: 'AI credits',
  cloudCreditsLeft: '{remaining} / {limit} left',
  cloudCreditsUnlimited: 'Unlimited',
  cloudCreditsRenews: 'Renews {date}',
  cloudSignedOutBody:
    'Sign in to UniWork to use web search, image generation and media analysis paid with your organization’s AI credits.',
  cloudNotEntitledBody:
    'Your organization’s plan doesn’t include UniWork cloud AI. You can still use your own providers below.',
  cloudExhaustedBody:
    'Your organization has used all its UniWork AI credits for this period. Cloud tools are paused until the credits renew; your own providers below keep working.',
  cloudUnavailableBody:
    'UniWork cloud AI is unavailable right now. Your own providers below keep working.',
  cloudReadyBody:
    'Search, image generation and media analysis without your own provider use your organization’s UniWork AI credits.',
  cloudToolsToggle: 'Use UniWork cloud tools',
  cloudToolsToggleDesc:
    'Without your own provider, web search, image generation and media analysis use UniWork cloud (spends AI credits).',
  cloudMediaLabel: 'UniWork cloud',
  cloudMediaDesc: 'Uses your organization’s UniWork AI credits; no key needed.',
  cloudSearchAutoHint: 'UniWork cloud first (spends AI credits), then free search.',
} satisfies Record<keyof typeof zh, string>
