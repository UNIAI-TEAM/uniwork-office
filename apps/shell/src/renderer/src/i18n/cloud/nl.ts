import type { zh } from './zh'

export const nl = {
  cloudTitle: 'UniWork cloud-AI',
  cloudStateReady: 'Beschikbaar',
  cloudStateNotEntitled: 'Niet in je abonnement',
  cloudStateExhausted: 'AI-tegoed op',
  cloudStateUnavailable: 'Niet beschikbaar',
  cloudStateSignedOut: 'Niet aangemeld',
  cloudStateInactive: 'Abonnement inactief',
  cloudCredits: 'AI-tegoed',
  cloudCreditsLeft: '{remaining} / {limit} over',
  cloudCreditsUnlimited: 'Onbeperkt',
  cloudCreditsRenews: 'Vernieuwt op {date}',
  cloudSignedOutBody:
    'Meld je aan bij UniWork om webzoeken, afbeeldingen maken en media-analyse te gebruiken, betaald met het AI-tegoed van je organisatie.',
  cloudNotEntitledBody:
    'Het abonnement van je organisatie bevat geen UniWork cloud-AI. Je eigen providers hieronder kun je blijven gebruiken.',
  cloudExhaustedBody:
    'Je organisatie heeft al het UniWork AI-tegoed voor deze periode gebruikt. Cloudtools staan stil tot het tegoed vernieuwt; je eigen providers hieronder blijven werken.',
  cloudUnavailableBody:
    'UniWork cloud-AI is nu niet beschikbaar. Je eigen providers hieronder blijven werken.',
  cloudInactiveBody:
    'Het UniWork-abonnement van je organisatie is niet actief, dus cloud-AI is gepauzeerd. Vraag een beheerder het te verlengen; je eigen providers hieronder blijven werken.',
  cloudToolsOffBody:
    'De UniWork cloudtools staan uit. Zet “{switch}” aan onder {section} om de AI-tegoeden van je organisatie te gebruiken; je eigen providers hieronder worden niet beïnvloed.',
  cloudReadyBody:
    'Zonder eigen provider gebruiken zoeken, afbeeldingen maken en media-analyse het UniWork AI-tegoed van je organisatie.',
  cloudToolsToggle: 'UniWork cloudtools gebruiken',
  cloudToolsToggleDesc:
    'Zonder eigen provider lopen webzoeken, afbeeldingen maken en media-analyse via de UniWork cloud (kost AI-tegoed).',
  cloudMediaLabel: 'UniWork cloud',
  cloudMediaDesc: 'Gebruikt het UniWork AI-tegoed van je organisatie; geen sleutel nodig.',
  cloudSearchAutoHint: 'Eerst UniWork cloud (kost AI-tegoed), daarna gratis zoeken.',
} satisfies Record<keyof typeof zh, string>
