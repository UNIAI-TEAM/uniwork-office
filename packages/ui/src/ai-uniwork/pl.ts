import type { zh } from './zh'

export const pl = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Pozostałe kredyty: {remaining} z {limit}',
  aiUniworkFooterSignIn: 'Zaloguj się do UniWork, aby korzystać z UniWork AI',
  aiUniworkSignedOut: 'Wylogowano z UniWork. Wybierz innego dostawcę lub zaloguj się ponownie.',
  aiUniworkOff: 'UniWork AI jest wyłączone dla tego dokumentu. Wybierz innego dostawcę.',
  aiUniworkViewOnly:
    'Tylko do odczytu: AI może odpowiadać, ale nie może edytować ani zapisywać dokumentu.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI odczytuje to, co jest otwarte w tym dokumencie, w tym niezapisane zmiany, i wysyła to do UniWork oraz dostawcy modelu, aby odpowiedzieć. Każde uruchomienie zużywa kredyty AI organizacji {org}. AI nigdy nie zapisuje za Ciebie: sprawdź, a potem naciśnij Zapisz.',
  aiUniworkDisclosureLabel: 'Co otrzymuje UniWork AI',
  aiUniworkDisclosureShort: 'Wysyła otwartą treść (także niezapisaną) do UniWork · kredyty {org}',
  aiUniworkLocalFile:
    'Ten plik jest na Twoim komputerze, nie w UniWork. Z UniWork AI treść otwartego pliku jest wysyłana do UniWork i zużywa kredyty AI organizacji {org}. Plik nie jest przesyłany jako dokument UniWork.',
  aiUniworkAck: 'Rozumiem',
  aiUniworkLearnMore: 'Dowiedz się więcej',
  aiUniworkDetails: 'Szczegóły',
  aiUniworkSendNeedsAck: 'Przeczytaj i potwierdź informację przed wysłaniem.',

  // S9 result chips and run controls
  aiResultAnswer: 'Odpowiedź',
  aiResultClarify: 'Wymaga doprecyzowania',
  aiResultEdited: 'Edytowano w dokumencie',
  aiResultUnsupported: 'Nieobsługiwane',
  aiResultError: 'Błąd',
  aiResultEditedHint:
    'Niezapisane — cofnij za pomocą Ctrl/⌘+Z lub naciśnij Zapisz, gdy wszystko jest w porządku.',
  aiResultViewChanges: 'Pokaż zmiany',
  aiRunStop: 'Zatrzymaj',
  aiRunSend: 'Wyślij',
  aiRunRunning: 'Trwa… Naciśnij Zatrzymaj lub Esc, aby zatrzymać.',
  aiRunStopped: 'Zatrzymano. Zastosowane już zmiany pozostają w dokumencie i można je cofnąć.',
  aiRunAskAgain: 'Zapytaj ponownie',
  aiRunChooseOther: 'Wybierz innego dostawcę',
  aiRunOpenInApp: 'Otwórz w aplikacji',
  aiConversationRestarted:
    'Poprzednia rozmowa wygasła, więc UniWork AI rozpoczęło nową i nie pamięta wcześniejszych wypowiedzi. Wyślij pytanie ponownie, aby kontynuować.',
  aiConversationBoundary: 'Nowa rozmowa z {provider}: powyższe wypowiedzi nie są wysyłane.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'To uruchomienie osiągnęło limit kroków UniWork AI. Dotychczasowe wyniki zostają zachowane; podziel prośbę i zapytaj ponownie.',
  aiErrCredits:
    'Twojej organizacji skończyły się kredyty AI w tym okresie. To uruchomienie zostało zatrzymane.',
  aiErrEntitlement: 'Plan Twojej organizacji nie obejmuje już UniWork AI.',
  aiErrRateLimited: 'Wysyłasz zbyt szybko. Spróbuj ponownie za {seconds} s.',
  aiErrRateLimitedNoWait: 'Wysyłasz zbyt szybko. Spróbuj ponownie za kilka minut.',
  aiErrUnavailable: 'UniWork AI w tej chwili nie odpowiada. Dokument i Zapisz nadal działają.',
  aiErrDisconnected:
    'Połączenie zostało przerwane, więc to uruchomienie zatrzymano. Zastosowane już zmiany pozostają w dokumencie i można je cofnąć.',
  aiErrOffline: 'Jesteś offline. UniWork AI nie działa offline, a prośby nie są kolejkowane.',
  aiErrSession:
    'Sesja UniWork wygasła, więc to uruchomienie zatrzymano. Zaloguj się ponownie, aby kontynuować.',
  aiErrRevoked: 'Nie masz już dostępu do tego dokumentu, więc uruchomienie AI zatrzymano.',
  aiErrDowngraded:
    'Twój dostęp właśnie zmienił się na tylko do odczytu, więc AI przestało edytować. Odpowiedzi są kontynuowane.',
  aiErrCapabilityOff:
    'UniWork AI właśnie wyłączono dla tego dokumentu, więc uruchomienie zatrzymano po bieżącym kroku.',
  aiErrUnsupported: 'UniWork AI nie potrafi jeszcze tego zrobić w {module}.',
  aiErrViewOnlyEdit: 'Masz tylko dostęp do odczytu tego dokumentu, więc AI nie może go edytować.',
} satisfies Record<keyof typeof zh, string>
