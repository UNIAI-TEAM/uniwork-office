import type { zh } from './zh'

export const cs = {
  aiWebClose: 'Zavřít',
  aiWebStateCreditsTitle: 'Kredity AI vyčerpány',
  aiWebStateCreditsBody:
    'Vaše organizace vyčerpala všechny kredity UniWork AI pro toto období. Obraťte se na správce nebo počkejte na obnovení.',
  aiWebStateEntitlementTitle: 'AI není ve vašem tarifu',
  aiWebStateEntitlementBody:
    'Tarif UniWork vaší organizace tuto funkci AI nezahrnuje. Obraťte se na správce.',
  aiWebStateRateTitle: 'Příliš mnoho požadavků AI',
  aiWebStateRateBody: 'Počkejte {seconds} s a zkuste to znovu.',
  aiWebStateRateBodyNow: 'Chvíli počkejte a zkuste to znovu.',
  aiWebStateUnreachableTitle: 'Poskytovatel AI je nedostupný',
  aiWebStateUnreachableBody:
    'UniWork se nepodařilo spojit s poskytovatelem AI. Zkuste to za chvíli.',
  aiWebStateCloudTitle: 'Cloudový nástroj není k dispozici',
  aiWebStateCloudBody: 'Tento nástroj UniWork AI zatím není na serveru nastaven.',
  aiWebStateOutageTitle: 'UniWork je dočasně nedostupný',
  aiWebStateOutageBody: 'UniWork je teď nedostupný. Zkuste to za chvíli.',
  aiWebStateSessionTitle: 'Relace vypršela',
  aiWebStateSessionBody: 'Pokračujte opětovným otevřením dokumentu z UniWork.',
  aiWebStateRefusedTitle: 'Požadavek odmítnut',
  aiWebStateRefusedBody: 'Server odmítl požadavek AI.',
  aiWebStateUnknownTitle: 'Požadavek AI selhal',
  aiWebStateUnknownBody: 'Něco se pokazilo. Zkuste to znovu.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Tento sešit je pro AI na webu příliš velký. Otevřete ho v aplikaci UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Pokračuj další částí.',
} satisfies Record<keyof typeof zh, string>
