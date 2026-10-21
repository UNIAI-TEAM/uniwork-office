import type { zh } from './zh'

export const nl = {
  askUniModeGroup: 'Modus',
  askUniModeChat: 'Assistent',
  askUniModeAsk: 'Vraag het UNI',
  askUniTitle: 'Vraag het UNI',
  askUniDescription:
    'UNI antwoordt alleen op basis van gegevens die jij in deze werkruimte kunt zien, met bronnen.',
  askUniWorkspace: 'Werkruimte',
  askUniEmptyTitle: 'Wat wil je weten over het werk van het team?',
  askUniEmptyDescription:
    'UNI leest taken, vergaderingen, gesprekken waaraan je deelneemt en leden; antwoorden vermelden altijd hun bronnen.',
  askUniPlaceholder: 'Vraag UNI iets over je werk…',
  askUniSend: 'Verzenden',
  askUniStop: 'Stoppen',
  askUniStopped: 'Gestopt. Het antwoord wordt niet getoond.',
  askUniThinking: 'UNI denkt na…',
  askUniNewChat: 'Nieuw gesprek',
  askUniYou: 'Jij',
  askUniUni: 'UNI',
  askUniSources: 'Bronnen',
  askUniKindDocument: 'Document',
  askUniKindTask: 'Taak',
  askUniKindMeeting: 'Vergadering',
  askUniKindChat: 'Gesprek',
  askUniKindMember: 'Lid',
  askUniOpenDocument: 'Document openen',
  askUniKindOther: 'Overig',
  askUniOpenBrowser: 'Openen in de browser',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniCounter: '{used}/{max} tekens',
  askUniLoading: 'Laden…',
  askUniSignedOut:
    'Meld je aan bij je UniWork-account om UNI vragen over je werkruimte te stellen.',
  askUniNoWorkspace: 'Je account heeft nog geen werkruimte om iets over te vragen.',
  askUniNoticeNoSources:
    'Niets wat je in deze werkruimte kunt zien komt al overeen met deze vraag.',
  askUniNoticeUnavailable: 'UNI kon deze vraag niet beantwoorden.',
  askUniErrForbidden: 'Je hebt geen toegang tot deze gegevens.',
  askUniErrQuota: 'De organisatie heeft het AI-tokenquotum van deze maand opgebruikt.',
  askUniErrRateLimited: 'Je stelt te snel vragen; probeer het over een minuut opnieuw.',
  askUniErrRateLimitedIn: 'Je stelt te snel vragen; probeer het over {seconds} seconden opnieuw.',
  askUniErrDisabled: 'AI is op deze server niet geconfigureerd.',
  askUniErrOffline:
    'Je bent offline. Vraag het UNI heeft een verbinding nodig om documenten te doorzoeken.',
  askUniErrSession: 'Je UniWork-sessie is verlopen. Meld je opnieuw aan om verder te vragen.',
  askUniErrDefault: 'Vragen stellen lukt nu niet; probeer het later opnieuw.',
  askUniOpenFailed:
    'Deze bron kon niet worden geopend. Probeer het opnieuw of open hem op het web.',
} satisfies Record<keyof typeof zh, string>
