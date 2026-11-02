import type { zh } from './zh'

export const nl = {
  cloudTitle: 'UniWork cloud-AI',
  cloudStateReady: 'Beschikbaar',
  cloudStateNotEntitled: 'Niet in je abonnement',
  cloudStateExhausted: 'AI-tegoed op',
  cloudStateUnavailable: 'Niet beschikbaar',
  cloudStateInactive: 'Abonnement inactief',
  cloudCredits: 'AI-tegoed',
  cloudCreditsLeft: '{remaining} / {limit} over',
  cloudCreditsUnlimited: 'Onbeperkt',
  cloudCreditsRenews: 'Vernieuwt op {date}',
  cloudToolsToggle: 'UniWork cloudtools gebruiken',
  cloudToolsToggleDesc:
    'Zonder eigen provider lopen webzoeken, afbeeldingen maken en media-analyse via de UniWork cloud (kost AI-tegoed).',
} satisfies Record<keyof typeof zh, string>
