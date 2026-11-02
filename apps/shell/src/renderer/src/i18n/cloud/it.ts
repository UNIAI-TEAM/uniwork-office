import type { zh } from './zh'

export const it = {
  cloudTitle: 'IA cloud UniWork',
  cloudStateReady: 'Disponibile',
  cloudStateNotEntitled: 'Non incluso nel tuo piano',
  cloudStateExhausted: 'Crediti IA esauriti',
  cloudStateUnavailable: 'Non disponibile',
  cloudStateInactive: 'Abbonamento inattivo',
  cloudCredits: 'Crediti IA',
  cloudCreditsLeft: '{remaining} / {limit} rimasti',
  cloudCreditsUnlimited: 'Illimitato',
  cloudCreditsRenews: 'Si rinnova il {date}',
  cloudToolsToggle: 'Usa gli strumenti cloud UniWork',
  cloudToolsToggleDesc:
    'Ricerca web, generazione di immagini e analisi dei media usano il cloud UniWork (consuma crediti IA).',
} satisfies Record<keyof typeof zh, string>
