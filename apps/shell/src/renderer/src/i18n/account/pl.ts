import type { zh } from './zh'

export const pl = {
  acctTitle: 'Konto UniWork',
  acctOpenSettings: 'Otwórz ustawienia konta',
  acctSignIn: 'Zaloguj się',
  acctSignInUniwork: 'Zaloguj się do UniWork',
  acctSignInAgain: 'Zaloguj się ponownie',
  acctSignOut: 'Wyloguj się',
  acctSigningOut: 'Wylogowywanie…',
  acctSigningIn: 'Logowanie…',
  acctSigningInHint: 'Dokończ logowanie w przeglądarce.',
  acctCancel: 'Anuluj',
  acctOpenAgain: 'Otwórz przeglądarkę ponownie',
  acctCopyLink: 'Kopiuj link do logowania',
  acctLinkCopied: 'Skopiowano link',
  acctSignedInAs: 'Zalogowano jako {name}',
  acctSignedOutTitle: 'Nie jesteś zalogowany',
  acctSignedOutBody:
    'Zaloguj się na konto UniWork, aby korzystać z planu Twojej organizacji na tym urządzeniu.',
  acctRefreshing: 'Aktualizowanie konta…',
  acctName: 'Nazwa',
  acctEmail: 'E-mail',
  acctOrg: 'Organizacja',
  acctPlan: 'Plan',
  acctServer: 'Serwer',
  acctNoPlan: 'Brak planu',
  acctSwitchOrg: 'Zmień organizację',
  acctSwitchOrgFailed: 'Nie udało się zmienić organizacji. Spróbuj ponownie.',
  acctExpiredShort: 'Sesja wygasła',
  acctExpiredTitle: 'Twoja sesja wygasła',
  acctExpiredBody:
    'Ze względów bezpieczeństwa zaloguj się ponownie, aby nadal korzystać z konta UniWork.',
  acctRevokedShort: 'Sesja zakończona',
  acctRevokedTitle: 'Wylogowano Cię na tym urządzeniu',
  acctRevokedBody:
    'Sesja na tym urządzeniu została zakończona z innego urządzenia lub przez administratora. Zaloguj się ponownie, aby kontynuować.',
  acctUnreachableTitle: 'Brak połączenia z UniWork',
  acctUnreachableBody:
    'Sprawdź połączenie z internetem lub ustawienia proxy. Nadal jesteś zalogowany; poniższe informacje mogą być nieaktualne.',
  acctRetry: 'Spróbuj ponownie',
  acctRetrying: 'Ponawianie…',
  acctWrongServerShort: 'Inny serwer',
  acctWrongServerTitle: 'Zalogowano do innego serwera',
  acctWrongServerBody:
    'Ta aplikacja jest połączona z serwerem {server}, ale Twoja sesja należy do innego serwera UniWork. Zaloguj się ponownie na serwerze {server} lub wyloguj się.',
  acctThisServer: 'skonfigurowany serwer',
  acctNotConfiguredShort: 'Niepołączono',
  acctNotConfiguredTitle: 'Brak połączenia z serwerem UniWork',
  acctNotConfiguredBody:
    'Ta kopia UniWork Office nie została jeszcze skonfigurowana z serwerem UniWork, więc logowanie jest niedostępne. Poproś administratora o skonfigurowany instalator.',
  acctKeyringShort: 'Wymagany bezpieczny magazyn',
  acctKeyringTitle: 'Bezpieczny magazyn jest niedostępny',
  acctKeyringBody:
    'UniWork Office przechowuje dane logowania w bezpiecznym magazynie systemu (Keychain, Credential Manager lub keyring). Odblokuj go lub skonfiguruj, a następnie wybierz Spróbuj ponownie.',
  acctErrLaunch: 'Nie udało się rozpocząć logowania. Spróbuj ponownie.',
  acctErrNetwork:
    'Nie można połączyć się z UniWork. Sprawdź połączenie z internetem lub ustawienia proxy.',
  acctErrTimeout: 'UniWork odpowiada zbyt długo. Spróbuj ponownie.',
  acctErrLoginTimeout: 'Upłynął limit czasu logowania. Spróbuj ponownie.',
  acctErrCancelled: 'Logowanie zostało anulowane.',
  acctErrInvalidCallback: 'Odpowiedź logowania jest nieprawidłowa. Spróbuj ponownie.',
  acctErrStateMismatch:
    'Ten link do logowania nie pasuje do bieżącej próby. Rozpocznij logowanie ponownie w aplikacji.',
  acctCallbackMismatch:
    'Ten link do logowania nie pasuje. Dokończ logowanie w oknie przeglądarki otwartym przez tę aplikację.',
  acctErrAuthCodeInvalid: 'Kod logowania wygasł lub został już użyty. Zaloguj się ponownie.',
  acctErrRateLimited: 'Zbyt wiele prób. Zaczekaj chwilę i spróbuj ponownie.',
  acctErrUnauthorized: 'Twoja sesja nie jest już ważna. Zaloguj się ponownie.',
  acctErrDeviceRevoked: 'Wylogowano to urządzenie. Zaloguj się ponownie.',
  acctErrRefreshReused:
    'Ze względów bezpieczeństwa ta sesja została zakończona. Zaloguj się ponownie.',
  acctErrWrongDeployment: 'To konto należy do innego serwera UniWork.',
  acctErrNotConfigured: 'Ta aplikacja nie jest połączona z serwerem UniWork.',
  acctErrKeyringUnavailable: 'Bezpieczny magazyn na tym komputerze jest niedostępny.',
  acctErrServerError: 'W UniWork wystąpił problem. Spróbuj ponownie później.',
  acctErrMalformedResponse: 'UniWork wysłał nieoczekiwaną odpowiedź. Spróbuj ponownie później.',
} satisfies Record<keyof typeof zh, string>
