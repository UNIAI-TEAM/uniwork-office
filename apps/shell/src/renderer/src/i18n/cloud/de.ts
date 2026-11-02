import type { zh } from './zh'

export const de = {
  cloudTitle: 'UniWork Cloud-KI',
  cloudStateReady: 'Verfügbar',
  cloudStateNotEntitled: 'Nicht in Ihrem Tarif',
  cloudStateExhausted: 'KI-Guthaben aufgebraucht',
  cloudStateUnavailable: 'Nicht verfügbar',
  cloudStateInactive: 'Abonnement inaktiv',
  cloudCredits: 'KI-Guthaben',
  cloudCreditsLeft: '{remaining} / {limit} übrig',
  cloudCreditsUnlimited: 'Unbegrenzt',
  cloudCreditsRenews: 'Erneuert am {date}',
  cloudToolsToggle: 'UniWork Cloud-Tools verwenden',
  cloudToolsToggleDesc:
    'Ohne eigenen Anbieter laufen Websuche, Bildgenerierung und Medienanalyse über die UniWork Cloud (verbraucht KI-Guthaben).',
} satisfies Record<keyof typeof zh, string>
