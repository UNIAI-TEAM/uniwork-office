import type { zh } from './zh'

export const de = {
  cloudTitle: 'UniWork Cloud-KI',
  cloudStatus: 'Status',
  cloudStateReady: 'Verfügbar',
  cloudStateNotEntitled: 'Nicht in Ihrem Tarif',
  cloudStateExhausted: 'KI-Guthaben aufgebraucht',
  cloudStateUnavailable: 'Nicht verfügbar',
  cloudCredits: 'KI-Guthaben',
  cloudCreditsLeft: '{remaining} / {limit} übrig',
  cloudCreditsUnlimited: 'Unbegrenzt',
  cloudCreditsRenews: 'Erneuert am {date}',
  cloudSignedOutBody:
    'Melden Sie sich bei UniWork an, um Websuche, Bildgenerierung und Medienanalyse mit dem KI-Guthaben Ihrer Organisation zu nutzen.',
  cloudNotEntitledBody:
    'Der Tarif Ihrer Organisation enthält keine UniWork Cloud-KI. Ihre eigenen Anbieter unten können Sie weiterhin nutzen.',
  cloudExhaustedBody:
    'Ihre Organisation hat ihr UniWork KI-Guthaben für diesen Zeitraum aufgebraucht. Cloud-Tools pausieren bis zur Erneuerung; Ihre eigenen Anbieter unten funktionieren weiter.',
  cloudUnavailableBody:
    'UniWork Cloud-KI ist gerade nicht verfügbar. Ihre eigenen Anbieter unten funktionieren weiter.',
  cloudReadyBody:
    'Ohne eigenen Anbieter nutzen Suche, Bildgenerierung und Medienanalyse das UniWork KI-Guthaben Ihrer Organisation.',
  cloudToolsToggle: 'UniWork Cloud-Tools verwenden',
  cloudToolsToggleDesc:
    'Ohne eigenen Anbieter laufen Websuche, Bildgenerierung und Medienanalyse über die UniWork Cloud (verbraucht KI-Guthaben).',
  cloudMediaLabel: 'UniWork Cloud',
  cloudMediaDesc: 'Nutzt das UniWork KI-Guthaben Ihrer Organisation; kein Schlüssel nötig.',
  cloudSearchAutoHint: 'Zuerst UniWork Cloud (verbraucht KI-Guthaben), dann kostenlose Suche.',
} satisfies Record<keyof typeof zh, string>
