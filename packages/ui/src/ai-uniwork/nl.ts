import type { zh } from './zh'

export const nl = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Resterende credits: {remaining} van {limit}',
  aiUniworkFooterSignIn: 'Meld je aan bij UniWork om UniWork AI te gebruiken',
  aiUniworkSignedOut:
    'Je bent afgemeld bij UniWork. Kies een andere provider of meld je opnieuw aan.',
  aiUniworkOff: 'UniWork AI staat uit voor dit document. Kies een andere provider.',
  aiUniworkViewOnly:
    'Alleen weergeven: AI kan antwoorden maar het document niet bewerken of opslaan.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI leest wat er in dit document geopend is, inclusief niet-opgeslagen wijzigingen, en stuurt het naar UniWork en de modelprovider om te antwoorden. Elke run gebruikt AI-credits van {org}. AI slaat nooit voor je op: controleer en druk dan op Opslaan.',
  aiUniworkDisclosureLabel: 'Wat UniWork AI ontvangt',
  aiUniworkDisclosureShort:
    'Stuurt geopende inhoud (ook niet-opgeslagen) naar UniWork · credits van {org}',
  aiUniworkLocalFile:
    'Dit bestand staat op je computer, niet in UniWork. Met UniWork AI wordt de inhoud van het geopende bestand naar UniWork gestuurd en worden AI-credits van {org} gebruikt. Het bestand wordt niet als UniWork-document geüpload.',
  aiUniworkAck: 'Begrepen',
  aiUniworkLearnMore: 'Meer informatie',
  aiUniworkDetails: 'Details',
  aiUniworkSendNeedsAck: 'Lees en bevestig de melding voordat je verzendt.',

  // S9 result chips and run controls
  aiResultAnswer: 'Antwoord',
  aiResultClarify: 'Verduidelijking nodig',
  aiResultEdited: 'Bewerkt in document',
  aiResultUnsupported: 'Niet ondersteund',
  aiResultError: 'Fout',
  aiResultEditedHint:
    'Niet opgeslagen — maak ongedaan met Ctrl/⌘+Z, of druk op Opslaan als het klopt.',
  aiResultViewChanges: 'Wijzigingen bekijken',
  aiRunStop: 'Stoppen',
  aiRunSend: 'Verzenden',
  aiRunRunning: 'Bezig… Druk op Stoppen of Esc om te stoppen.',
  aiRunStopped:
    'Gestopt. Al toegepaste wijzigingen blijven in het document en kunnen ongedaan worden gemaakt.',
  aiRunAskAgain: 'Opnieuw vragen',
  aiRunChooseOther: 'Andere provider kiezen',
  aiRunOpenInApp: 'Openen in de app',
  aiConversationRestarted:
    'Het vorige gesprek is verlopen, dus UniWork AI is een nieuw gesprek begonnen en onthoudt eerdere beurten niet meer. Stuur je vraag opnieuw om verder te gaan.',
  aiConversationBoundary:
    'Nieuw gesprek met {provider}: de beurten hierboven worden niet meegestuurd.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Deze run heeft de staplimiet van UniWork AI bereikt. De resultaten tot nu toe blijven bewaard; splits het verzoek en vraag het opnieuw.',
  aiErrCredits: 'Je organisatie heeft geen AI-credits meer voor deze periode. Deze run is gestopt.',
  aiErrEntitlement: 'Het abonnement van je organisatie bevat UniWork AI niet meer.',
  aiErrRateLimited: 'Je verzendt te snel. Probeer het over {seconds} s opnieuw.',
  aiErrRateLimitedNoWait: 'Je verzendt te snel. Probeer het over een paar minuten opnieuw.',
  aiErrUnavailable: 'UniWork AI reageert nu niet. Je document en Opslaan werken nog steeds.',
  aiErrDisconnected:
    'De verbinding is weggevallen, dus deze run is gestopt. Al toegepaste wijzigingen blijven in het document en kunnen ongedaan worden gemaakt.',
  aiErrOffline:
    'Je bent offline. UniWork AI werkt niet offline en verzoeken worden niet in de wachtrij gezet.',
  aiErrSession:
    'Je UniWork-sessie is verlopen, dus deze run is gestopt. Meld je opnieuw aan om verder te gaan.',
  aiErrRevoked: 'Je hebt geen toegang meer tot dit document, dus de AI-run is gestopt.',
  aiErrDowngraded:
    'Je toegang is zojuist gewijzigd naar alleen weergeven, dus AI bewerkt niet meer. Antwoorden gaan door.',
  aiErrCapabilityOff:
    'UniWork AI is zojuist uitgezet voor dit document, dus de run is na de huidige stap gestopt.',
  aiErrUnsupported: 'UniWork AI kan dit nog niet in {module}.',
  aiErrViewOnlyEdit:
    'Je hebt alleen weergavetoegang tot dit document, dus AI kan het niet bewerken.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'Je verzoek is te lang voor UniWork AI. Maak het korter dan 8.000 tekens en verstuur het opnieuw.',
  aiErrQuestionRejected:
    'UniWork AI kon dit verzoek niet accepteren. Pas het aan en verstuur het opnieuw.',
  aiUniworkImagesNotSent:
    'Afbeeldingen worden niet naar UniWork AI gestuurd; alleen je tekst is verstuurd.',
} satisfies Record<keyof typeof zh, string>
