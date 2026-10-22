import type { zh } from './zh'

export const pl = {
  // copy shared with the Home Ask UNI pane
  askUniThinking: 'UNI myśli…',
  askUniYou: 'Ty',
  askUniUni: 'UNI',
  askUniSources: 'Źródła',
  askUniKindDocument: 'Dokument',
  askUniKindTask: 'Zadanie',
  askUniKindMeeting: 'Spotkanie',
  askUniKindChat: 'Rozmowa',
  askUniKindMember: 'Członek',
  askUniKindOther: 'Inne',
  askUniOpenDocument: 'Otwórz dokument',
  askUniOpenBrowser: 'Otwórz w przeglądarce',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniOpenFailed:
    'Nie udało się otworzyć tego źródła. Spróbuj ponownie lub otwórz je w przeglądarce.',
  askUniErrForbidden: 'Nie masz dostępu do tych danych.',
  askUniErrQuota: 'Organizacja wykorzystała limit tokenów AI na ten miesiąc.',
  askUniErrRateLimited: 'Pytasz zbyt szybko; spróbuj ponownie za minutę.',
  askUniErrRateLimitedIn: 'Pytasz zbyt szybko; spróbuj ponownie za {seconds} s.',
  askUniErrDisabled: 'AI nie jest skonfigurowane na tym serwerze.',
  askUniErrOffline: 'Jesteś offline. Zapytaj UNI wymaga połączenia, aby przeszukiwać dokumenty.',
  askUniErrSession: 'Sesja UniWork wygasła. Zaloguj się ponownie, aby dalej pytać.',
  askUniErrDefault: 'Nie można teraz zadać pytania; spróbuj później.',
  askUniSignedOut: 'Zaloguj się na konto UniWork, aby pytać UNI o swoją przestrzeń roboczą.',
  askUniNoticeNoSources:
    'Nic, co widzisz w tej przestrzeni roboczej, nie pasuje jeszcze do tego pytania.',
  askUniNoticeUnavailable: 'UNI nie potrafił odpowiedzieć na to pytanie.',
  askUniStop: 'Zatrzymaj',
  askUniSend: 'Wyślij',
  askUniCounter: '{used}/{max} znaków',
  askUniPlaceholder: 'Zapytaj UNI o swoją pracę…',
} satisfies Record<keyof typeof zh, string>
