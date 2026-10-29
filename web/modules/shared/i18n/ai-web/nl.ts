import type { zh } from './zh'

export const nl = {
  aiWebClose: 'Sluiten',
  aiWebStateCreditsTitle: 'AI-credits op',
  aiWebStateCreditsBody:
    'Je organisatie heeft alle UniWork AI-credits van deze periode gebruikt. Vraag je beheerder of wacht tot ze worden vernieuwd.',
  aiWebStateEntitlementTitle: 'AI zit niet in je abonnement',
  aiWebStateEntitlementBody:
    'Het UniWork-abonnement van je organisatie bevat deze AI-functie niet. Vraag je beheerder.',
  aiWebStateRateTitle: 'Te veel AI-verzoeken',
  aiWebStateRateBody: 'Wacht {seconds} s en probeer het opnieuw.',
  aiWebStateRateBodyNow: 'Wacht even en probeer het opnieuw.',
  aiWebStateUnreachableTitle: 'AI-aanbieder onbereikbaar',
  aiWebStateUnreachableBody: 'UniWork kon de AI-aanbieder niet bereiken. Probeer het zo opnieuw.',
  aiWebStateCloudTitle: 'Cloudtool niet beschikbaar',
  aiWebStateCloudBody: 'Deze UniWork AI-tool is nog niet ingesteld op de server.',
  aiWebStateOutageTitle: 'UniWork tijdelijk niet beschikbaar',
  aiWebStateOutageBody: 'UniWork is nu niet bereikbaar. Probeer het zo opnieuw.',
  aiWebStateSessionTitle: 'Sessie verlopen',
  aiWebStateSessionBody: 'Open het document opnieuw vanuit UniWork om verder te gaan.',
  aiWebStateRefusedTitle: 'Verzoek geweigerd',
  aiWebStateRefusedBody: 'De server weigerde het AI-verzoek.',
  aiWebStateUnknownTitle: 'AI-verzoek mislukt',
  aiWebStateUnknownBody: 'Er ging iets mis. Probeer het opnieuw.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Deze werkmap is te groot voor AI op het web. Open hem in de UniWork Office-app.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Ga verder met het volgende deel.',
} satisfies Record<keyof typeof zh, string>
