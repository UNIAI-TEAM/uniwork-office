import type { zh } from './zh'

export const pl = {
  aiWebClose: 'Zamknij',
  aiWebStateCreditsTitle: 'Wyczerpano kredyty AI',
  aiWebStateCreditsBody:
    'Twoja organizacja wykorzystała wszystkie kredyty UniWork AI w tym okresie. Skontaktuj się z administratorem lub poczekaj na odnowienie.',
  aiWebStateEntitlementTitle: 'AI nie ma w Twoim planie',
  aiWebStateEntitlementBody:
    'Plan UniWork Twojej organizacji nie obejmuje tej funkcji AI. Skontaktuj się z administratorem.',
  aiWebStateRateTitle: 'Zbyt wiele żądań AI',
  aiWebStateRateBody: 'Odczekaj {seconds} s i spróbuj ponownie.',
  aiWebStateRateBodyNow: 'Odczekaj chwilę i spróbuj ponownie.',
  aiWebStateUnreachableTitle: 'Dostawca AI jest nieosiągalny',
  aiWebStateUnreachableBody:
    'UniWork nie mógł połączyć się z dostawcą AI. Spróbuj ponownie za chwilę.',
  aiWebStateCloudTitle: 'Narzędzie chmurowe niedostępne',
  aiWebStateCloudBody: 'To narzędzie UniWork AI nie jest jeszcze skonfigurowane na serwerze.',
  aiWebStateOutageTitle: 'UniWork chwilowo niedostępny',
  aiWebStateOutageBody: 'Nie można teraz połączyć się z UniWork. Spróbuj ponownie za chwilę.',
  aiWebStateSessionTitle: 'Sesja wygasła',
  aiWebStateSessionBody: 'Otwórz dokument ponownie z UniWork, aby kontynuować.',
  aiWebStateRefusedTitle: 'Żądanie odrzucone',
  aiWebStateRefusedBody: 'Serwer odrzucił żądanie AI.',
  aiWebStateUnknownTitle: 'Żądanie AI nie powiodło się',
  aiWebStateUnknownBody: 'Coś poszło nie tak. Spróbuj ponownie.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Ten skoroszyt jest za duży dla AI w przeglądarce. Otwórz go w aplikacji UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Przejdź do następnej części.',
} satisfies Record<keyof typeof zh, string>
