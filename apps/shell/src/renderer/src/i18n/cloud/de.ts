import type { zh } from './zh'

export const de = {
  cloudTitle: 'UniWork Cloud-KI',
  cloudStateReady: 'Verfügbar',
  cloudStateNotEntitled: 'Nicht in Ihrem Tarif',
  cloudStateExhausted: 'KI-Guthaben aufgebraucht',
  cloudStateUnavailable: 'Nicht verfügbar',
  cloudStateSignedOut: 'Nicht angemeldet',
  cloudStateInactive: 'Abonnement inaktiv',
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
  cloudInactiveBody:
    'Das UniWork-Abonnement Ihrer Organisation ist nicht aktiv, daher ist die Cloud-KI pausiert. Bitten Sie einen Administrator um die Verlängerung; Ihre eigenen Anbieter unten funktionieren weiter.',
  cloudToolsOffBody:
    'Die UniWork Cloud-Tools sind ausgeschaltet. Schalten Sie unter {section} „{switch}“ ein, um das KI-Guthaben Ihrer Organisation zu nutzen; Ihre eigenen Anbieter unten sind nicht betroffen.',
  cloudReadyBody:
    'Ohne eigenen Anbieter nutzen Suche, Bildgenerierung und Medienanalyse das UniWork KI-Guthaben Ihrer Organisation.',
  cloudToolsToggle: 'UniWork Cloud-Tools verwenden',
  cloudToolsToggleDesc:
    'Ohne eigenen Anbieter laufen Websuche, Bildgenerierung und Medienanalyse über die UniWork Cloud (verbraucht KI-Guthaben).',
  cloudMediaLabel: 'UniWork Cloud',
  cloudMediaDesc: 'Nutzt das UniWork KI-Guthaben Ihrer Organisation; kein Schlüssel nötig.',
  cloudSearchAutoHint: 'Zuerst UniWork Cloud (verbraucht KI-Guthaben), dann kostenlose Suche.',
  aiTestErrInvalidKey: 'API-Schlüssel fehlt oder wurde abgelehnt',
  aiTestErrNetwork: 'Keine Verbindung. Prüfen Sie Ihr Netzwerk',
  aiTestErrLimit: 'Limit des Anbieters erreicht. Später erneut versuchen',
  aiTestErrUnavailable: 'Dienst antwortet nicht. Später erneut versuchen',
} satisfies Record<keyof typeof zh, string>
