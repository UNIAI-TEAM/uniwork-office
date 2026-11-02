import type { zh } from './zh'

export const pl = {
  cloudTitle: 'Chmurowa AI UniWork',
  cloudStateReady: 'Dostępna',
  cloudStateNotEntitled: 'Nie ma w Twoim planie',
  cloudStateExhausted: 'Brak kredytów AI',
  cloudStateUnavailable: 'Niedostępna',
  cloudStateInactive: 'Subskrypcja nieaktywna',
  cloudCredits: 'Kredyty AI',
  cloudCreditsLeft: 'Pozostało {remaining} / {limit}',
  cloudCreditsUnlimited: 'Bez limitu',
  cloudCreditsRenews: 'Odnowienie {date}',
  cloudToolsToggle: 'Używaj narzędzi chmurowych UniWork',
  cloudToolsToggleDesc:
    'Bez własnego dostawcy wyszukiwanie w sieci, generowanie obrazów i analiza multimediów działają przez chmurę UniWork (zużywa kredyty AI).',
} satisfies Record<keyof typeof zh, string>
