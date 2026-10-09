import type { zh } from './zh'

export const pl = {
  cloudTitle: 'Chmurowa AI UniWork',
  cloudStatus: 'Stan',
  cloudStateReady: 'Dostępna',
  cloudStateNotEntitled: 'Nie ma w Twoim planie',
  cloudStateExhausted: 'Brak kredytów AI',
  cloudStateUnavailable: 'Niedostępna',
  cloudCredits: 'Kredyty AI',
  cloudCreditsLeft: 'Pozostało {remaining} / {limit}',
  cloudCreditsUnlimited: 'Bez limitu',
  cloudCreditsRenews: 'Odnowienie {date}',
  cloudSignedOutBody:
    'Zaloguj się do UniWork, aby korzystać z wyszukiwania w sieci, generowania obrazów i analizy multimediów opłacanych kredytami AI organizacji.',
  cloudNotEntitledBody:
    'Plan Twojej organizacji nie obejmuje chmurowej AI UniWork. Nadal możesz korzystać z własnych dostawców poniżej.',
  cloudExhaustedBody:
    'Twoja organizacja wykorzystała wszystkie kredyty AI UniWork w tym okresie. Narzędzia chmurowe są wstrzymane do odnowienia; własni dostawcy poniżej działają dalej.',
  cloudUnavailableBody:
    'Chmurowa AI UniWork jest teraz niedostępna. Własni dostawcy poniżej działają dalej.',
  cloudReadyBody:
    'Bez własnego dostawcy wyszukiwanie, generowanie obrazów i analiza multimediów korzystają z kredytów AI UniWork organizacji.',
  cloudToolsToggle: 'Używaj narzędzi chmurowych UniWork',
  cloudToolsToggleDesc:
    'Bez własnego dostawcy wyszukiwanie w sieci, generowanie obrazów i analiza multimediów działają przez chmurę UniWork (zużywa kredyty AI).',
  cloudMediaLabel: 'Chmura UniWork',
  cloudMediaDesc: 'Korzysta z kredytów AI UniWork organizacji; klucz nie jest potrzebny.',
  cloudSearchAutoHint: 'Najpierw chmura UniWork (zużywa kredyty AI), potem darmowe wyszukiwanie.',
} satisfies Record<keyof typeof zh, string>
