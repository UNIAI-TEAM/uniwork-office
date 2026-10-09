import type { zh } from './zh'

export const it = {
  cloudTitle: 'IA cloud UniWork',
  cloudStatus: 'Stato',
  cloudStateReady: 'Disponibile',
  cloudStateNotEntitled: 'Non incluso nel tuo piano',
  cloudStateExhausted: 'Crediti IA esauriti',
  cloudStateUnavailable: 'Non disponibile',
  cloudCredits: 'Crediti IA',
  cloudCreditsLeft: '{remaining} / {limit} rimasti',
  cloudCreditsUnlimited: 'Illimitato',
  cloudCreditsRenews: 'Si rinnova il {date}',
  cloudSignedOutBody:
    'Accedi a UniWork per usare ricerca web, generazione di immagini e analisi dei media pagate con i crediti IA della tua organizzazione.',
  cloudNotEntitledBody:
    'Il piano della tua organizzazione non include l’IA cloud UniWork. Puoi comunque usare i tuoi fornitori qui sotto.',
  cloudExhaustedBody:
    'La tua organizzazione ha esaurito i crediti IA UniWork per questo periodo. Gli strumenti cloud sono in pausa fino al rinnovo; i tuoi fornitori qui sotto continuano a funzionare.',
  cloudUnavailableBody:
    'L’IA cloud UniWork non è disponibile al momento. I tuoi fornitori qui sotto continuano a funzionare.',
  cloudReadyBody:
    'Senza un fornitore proprio, ricerca, generazione di immagini e analisi dei media usano i crediti IA UniWork della tua organizzazione.',
  cloudToolsToggle: 'Usa gli strumenti cloud UniWork',
  cloudToolsToggleDesc:
    'Senza un fornitore proprio, ricerca web, generazione di immagini e analisi dei media usano il cloud UniWork (consuma crediti IA).',
  cloudMediaLabel: 'Cloud UniWork',
  cloudMediaDesc: 'Usa i crediti IA UniWork della tua organizzazione; nessuna chiave richiesta.',
  cloudSearchAutoHint: 'Prima il cloud UniWork (consuma crediti IA), poi la ricerca gratuita.',
} satisfies Record<keyof typeof zh, string>
