import type { zh } from './zh'

export const nl = {
  // copy shared with the Home Ask UNI pane
  askUniThinking: 'UNI denkt na…',
  askUniYou: 'Jij',
  askUniUni: 'UNI',
  askUniSources: 'Bronnen',
  askUniKindDocument: 'Document',
  askUniKindTask: 'Taak',
  askUniKindMeeting: 'Vergadering',
  askUniKindChat: 'Gesprek',
  askUniKindMember: 'Lid',
  askUniKindOther: 'Overig',
  askUniOpenDocument: 'Document openen',
  askUniOpenBrowser: 'Openen in de browser',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniOpenFailed:
    'Deze bron kon niet worden geopend. Probeer het opnieuw of open hem op het web.',
  askUniErrForbidden: 'Je hebt geen toegang tot deze gegevens.',
  askUniErrQuota: 'De organisatie heeft het AI-tokenquotum van deze maand opgebruikt.',
  askUniErrRateLimited: 'Je stelt te snel vragen; probeer het over een minuut opnieuw.',
  askUniErrRateLimitedIn: 'Je stelt te snel vragen; probeer het over {seconds} seconden opnieuw.',
  askUniErrDisabled: 'AI is op deze server niet geconfigureerd.',
  askUniErrOffline:
    'Je bent offline. Vraag het UNI heeft een verbinding nodig om documenten te doorzoeken.',
  askUniErrSession: 'Je UniWork-sessie is verlopen. Meld je opnieuw aan om verder te vragen.',
  askUniErrDefault: 'Vragen stellen lukt nu niet; probeer het later opnieuw.',
  askUniSignedOut:
    'Meld je aan bij je UniWork-account om UNI vragen over je werkruimte te stellen.',
  askUniNoticeNoSources:
    'Niets wat je in deze werkruimte kunt zien komt al overeen met deze vraag.',
  askUniNoticeUnavailable: 'UNI kon deze vraag niet beantwoorden.',
  askUniStop: 'Stoppen',
  askUniSend: 'Verzenden',
  askUniCounter: '{used}/{max} tekens',
  askUniPlaceholder: 'Vraag UNI iets over je werk…',
} satisfies Record<keyof typeof zh, string>
