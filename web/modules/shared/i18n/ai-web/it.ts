import type { zh } from './zh'

export const it = {
  aiWebClose: 'Chiudi',
  aiWebStateCreditsTitle: 'Crediti IA esauriti',
  aiWebStateCreditsBody:
    "La tua organizzazione ha usato tutti i crediti UniWork AI di questo periodo. Rivolgiti all'amministratore o attendi il rinnovo.",
  aiWebStateEntitlementTitle: "L'IA non è nel tuo piano",
  aiWebStateEntitlementBody:
    "Il piano UniWork della tua organizzazione non include questa funzione IA. Rivolgiti all'amministratore.",
  aiWebStateRateTitle: 'Troppe richieste IA',
  aiWebStateRateBody: 'Attendi {seconds} s e riprova.',
  aiWebStateRateBodyNow: 'Attendi un momento e riprova.',
  aiWebStateUnreachableTitle: 'Fornitore IA non raggiungibile',
  aiWebStateUnreachableBody:
    'UniWork non è riuscito a raggiungere il fornitore IA. Riprova tra poco.',
  aiWebStateCloudTitle: 'Strumento cloud non disponibile',
  aiWebStateCloudBody: 'Questo strumento UniWork AI non è ancora configurato sul server.',
  aiWebStateOutageTitle: 'UniWork temporaneamente non disponibile',
  aiWebStateOutageBody: 'UniWork non è raggiungibile in questo momento. Riprova tra poco.',
  aiWebStateSessionTitle: 'Sessione scaduta',
  aiWebStateSessionBody: 'Riapri il documento da UniWork per continuare.',
  aiWebStateRefusedTitle: 'Richiesta rifiutata',
  aiWebStateRefusedBody: 'Il server ha rifiutato la richiesta IA.',
  aiWebStateUnknownTitle: 'Richiesta IA non riuscita',
  aiWebStateUnknownBody: 'Si è verificato un problema. Riprova.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Questa cartella di lavoro è troppo grande per l’IA sul web. Aprila nell’app UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Continua con la parte successiva.',
} satisfies Record<keyof typeof zh, string>
