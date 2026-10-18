import type { zh } from './zh'

export const cs = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Zbývající kredity: {remaining} z {limit}',
  aiUniworkFooterSignIn: 'Pro UniWork AI se přihlaste do UniWork',
  aiUniworkSignedOut:
    'Jste odhlášeni z UniWork. Vyberte jiného poskytovatele nebo se znovu přihlaste.',
  aiUniworkOff: 'UniWork AI je pro tento dokument vypnuto. Vyberte jiného poskytovatele.',
  aiUniworkViewOnly: 'Jen zobrazení: AI může odpovídat, ale nemůže dokument upravovat ani ukládat.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI čte, co je v tomto dokumentu otevřené, včetně neuložených změn, a kvůli odpovědi to odesílá do UniWork a poskytovateli modelu. Každý běh spotřebuje kredity AI organizace {org}. AI za vás nikdy neukládá: zkontrolujte a pak stiskněte Uložit.',
  aiUniworkDisclosureLabel: 'Co UniWork AI dostává',
  aiUniworkDisclosureShort: 'Odesílá otevřený obsah (i neuložený) do UniWork · kredity {org}',
  aiUniworkLocalFile:
    'Tento soubor je ve vašem počítači, ne v UniWork. S UniWork AI se obsah otevřeného souboru odešle do UniWork a spotřebuje kredity AI organizace {org}. Soubor se nenahraje jako dokument UniWork.',
  aiUniworkAck: 'Rozumím',
  aiUniworkLearnMore: 'Další informace',
  aiUniworkDetails: 'Podrobnosti',
  aiUniworkSendNeedsAck: 'Před odesláním si přečtěte a potvrďte upozornění.',

  // S9 result chips and run controls
  aiResultAnswer: 'Odpověď',
  aiResultClarify: 'Vyžaduje upřesnění',
  aiResultEdited: 'Upraveno v dokumentu',
  aiResultUnsupported: 'Nepodporováno',
  aiResultError: 'Chyba',
  aiResultEditedHint:
    'Neuloženo — vraťte zpět pomocí Ctrl/⌘+Z, nebo stiskněte Uložit, až to bude v pořádku.',
  aiResultViewChanges: 'Zobrazit změny',
  aiRunStop: 'Zastavit',
  aiRunSend: 'Odeslat',
  aiRunRunning: 'Probíhá… Zastavíte tlačítkem Zastavit nebo klávesou Esc.',
  aiRunStopped: 'Zastaveno. Již použité změny zůstávají v dokumentu a lze je vrátit zpět.',
  aiRunRetry: 'Zkusit znovu',
  aiRunAskAgain: 'Zeptat se znovu',
  aiRunChooseOther: 'Vybrat jiného poskytovatele',
  aiRunOpenInApp: 'Otevřít v aplikaci',
  aiConversationRestarted:
    'Předchozí konverzace vypršela, takže UniWork AI začalo novou a dřívější kroky si nepamatuje. Chcete-li pokračovat, pošlete dotaz znovu.',
  aiConversationBoundary: 'Nová konverzace s {provider}: kroky výše se neodesílají.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Tento běh dosáhl limitu kroků UniWork AI. Dosavadní výsledky zůstávají zachovány; rozdělte požadavek a zeptejte se znovu.',
  aiErrCredits: 'Vaší organizaci došly kredity AI pro toto období. Tento běh se zastavil.',
  aiErrEntitlement: 'Tarif vaší organizace už nezahrnuje UniWork AI.',
  aiErrRateLimited: 'Odesíláte příliš rychle. Zkuste to znovu za {seconds} s.',
  aiErrRateLimitedNoWait: 'Odesíláte příliš rychle. Zkuste to znovu za několik minut.',
  aiErrUnavailable: 'UniWork AI teď neodpovídá. Dokument i Uložit dál fungují.',
  aiErrGeneric:
    'UniWork AI narazil na neočekávaný problém, a proto byl tento běh zastaven. Dokument i Uložit dál fungují.',
  aiErrDisconnected:
    'Připojení se přerušilo, takže se tento běh zastavil. Již použité změny zůstávají v dokumentu a lze je vrátit zpět.',
  aiErrOffline: 'Jste offline. UniWork AI offline nefunguje a požadavky se neřadí do fronty.',
  aiErrSession:
    'Relace UniWork vypršela, takže se tento běh zastavil. Chcete-li pokračovat, znovu se přihlaste.',
  aiErrRevoked: 'K tomuto dokumentu už nemáte přístup, takže se běh AI zastavil.',
  aiErrDowngraded:
    'Váš přístup se právě změnil na jen zobrazení, takže AI přestalo upravovat. Odpovědi pokračují.',
  aiErrCapabilityOff:
    'UniWork AI bylo pro tento dokument právě vypnuto, takže se běh zastavil po aktuálním kroku.',
  aiErrUnsupported: 'UniWork AI to zatím v {module} neumí.',
  aiErrViewOnlyEdit:
    'K tomuto dokumentu máte jen přístup pro zobrazení, takže ho AI nemůže upravit.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'Požadavek je pro UniWork AI příliš dlouhý. Zkraťte ho pod 8 000 znaků a odešlete znovu.',
  aiErrQuestionRejected: 'UniWork AI tento požadavek nemůže přijmout. Upravte ho a odešlete znovu.',
  aiUniworkImagesNotSent: 'Obrázky se do UniWork AI neodesílají; odeslal se jen text.',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
  cloudStateNotEntitled: 'Není ve vašem tarifu',
  cloudStateExhausted: 'Kredity AI vyčerpány',
  cloudStateUnavailable: 'Nedostupné',
  cloudStateInactive: 'Předplatné není aktivní',
  cloudCreditsLeft: 'Zbývá {remaining} / {limit}',
  cloudCreditsUnlimited: 'Neomezeně',
  cloudInactiveBody:
    'Předplatné UniWork vaší organizace není aktivní, proto je cloudová AI pozastavena. Požádejte správce o obnovení; vaši vlastní poskytovatelé níže fungují dál.',
  acctSignIn: 'Přihlásit se',
  acctSignInAgain: 'Přihlásit se znovu',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart:
    'Místní soubory zahajují novou konverzaci v rámci vaší organizace a neuchovávají kola z jiných souborů.',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta:
    'Zapsané buňky: {written} ({range}) · Přepsané existující buňky: {overwritten}',
  aiResultCellsMetaNoOverwrite: 'Zapsané buňky: {written} ({range})',
  aiErrWorkbookTooLarge:
    'Tento sešit je pro AI na webu příliš velký. Otevřete ho v aplikaci UniWork Office.',
  // S7 composer notice keys (not_entitled, credits_exhausted)
  not_entitled:
    'Tarif vaší organizace nezahrnuje UniWork AI. Informujte se u správce organizace ohledně tarifu, nebo přidejte vlastní klíč AI v Nastavení > Model AI.',
  credits_exhausted:
    'Vaše organizace vyčerpala všechny své kredity AI pro toto období. Požádejte správce organizace o doplnění kreditů, nebo přidejte vlastní klíč AI v Nastavení > Model AI.',
} satisfies Record<keyof typeof zh, string>
