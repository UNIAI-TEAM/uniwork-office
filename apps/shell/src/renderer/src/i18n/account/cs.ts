import type { zh } from './zh'

export const cs = {
  acctTitle: 'Účet UniWork',
  acctOpenSettings: 'Otevřít nastavení účtu',
  acctSignIn: 'Přihlásit se',
  acctSignInUniwork: 'Přihlásit se k UniWork',
  acctSignInAgain: 'Přihlásit se znovu',
  acctSignOut: 'Odhlásit se',
  acctSigningOut: 'Odhlašování…',
  acctSigningIn: 'Přihlašování…',
  acctSigningInHint: 'Přihlášení dokončete v prohlížeči.',
  acctCancel: 'Zrušit',
  acctOpenAgain: 'Znovu otevřít prohlížeč',
  acctCopyLink: 'Kopírovat odkaz pro přihlášení',
  acctLinkCopied: 'Odkaz zkopírován',
  acctSignedInAs: 'Přihlášen jako {name}',
  acctSignedOutTitle: 'Nejste přihlášeni',
  acctSignedOutBody:
    'Přihlaste se účtem UniWork a používejte na tomto zařízení tarif své organizace.',
  acctRefreshing: 'Aktualizace účtu…',
  acctName: 'Jméno',
  acctEmail: 'E-mail',
  acctOrg: 'Organizace',
  acctPlan: 'Tarif',
  acctServer: 'Server',
  acctNoPlan: 'Žádný tarif',
  acctSwitchOrg: 'Přepnout organizaci',
  acctSwitchOrgFailed: 'Organizaci se nepodařilo přepnout. Zkuste to prosím znovu.',
  acctExpiredShort: 'Relace vypršela',
  acctExpiredTitle: 'Vaše relace vypršela',
  acctExpiredBody:
    'Z bezpečnostních důvodů se přihlaste znovu, abyste mohli dál používat účet UniWork.',
  acctRevokedShort: 'Relace ukončena',
  acctRevokedTitle: 'Na tomto zařízení jste byli odhlášeni',
  acctRevokedBody:
    'Relace tohoto zařízení byla ukončena z jiného zařízení nebo správcem. Pokračujte novým přihlášením.',
  acctUnreachableTitle: 'UniWork není dostupný',
  acctUnreachableBody:
    'Zkontrolujte připojení k internetu nebo nastavení proxy. Stále jste přihlášeni; níže uvedené údaje mohou být zastaralé.',
  acctRetry: 'Zkusit znovu',
  acctRetrying: 'Opakování…',
  acctWrongServerShort: 'Jiný server',
  acctWrongServerTitle: 'Přihlášení k jinému serveru',
  acctWrongServerBody:
    'Tato aplikace je propojena se serverem {server}, ale vaše relace patří jinému serveru UniWork. Přihlaste se znovu k serveru {server} nebo se odhlaste.',
  acctThisServer: 'nakonfigurovaný server',
  acctNotConfiguredShort: 'Nepropojeno',
  acctNotConfiguredTitle: 'Nepropojeno se serverem UniWork',
  acctNotConfiguredBody:
    'Tato kopie UniWork Office zatím není nastavena na server UniWork, proto není přihlášení dostupné. Požádejte správce o nakonfigurovaný instalační balíček.',
  acctKeyringShort: 'Nutné zabezpečené úložiště',
  acctKeyringTitle: 'Zabezpečené úložiště není dostupné',
  acctKeyringBody:
    'UniWork Office ukládá vaše přihlášení do zabezpečeného úložiště systému (Keychain, Credential Manager nebo keyring). Odemkněte je nebo nastavte a poté klikněte na Zkusit znovu.',
  acctErrLaunch: 'Přihlášení se nepodařilo spustit. Zkuste to prosím znovu.',
  acctErrNetwork:
    'Nelze se připojit k UniWork. Zkontrolujte připojení k internetu nebo nastavení proxy.',
  acctErrTimeout: 'UniWork odpovídá příliš dlouho. Zkuste to prosím znovu.',
  acctErrLoginTimeout: 'Přihlášení vypršelo. Zkuste to prosím znovu.',
  acctErrCancelled: 'Přihlášení bylo zrušeno.',
  acctErrInvalidCallback: 'Odpověď přihlášení není platná. Zkuste to prosím znovu.',
  acctErrStateMismatch:
    'Tento odkaz pro přihlášení neodpovídá aktuálnímu pokusu. Spusťte přihlášení znovu v aplikaci.',
  acctCallbackMismatch:
    'Tento odkaz pro přihlášení neodpovídá. Dokončete přihlášení v okně prohlížeče, které otevřela tato aplikace.',
  acctErrAuthCodeInvalid: 'Přihlašovací kód vypršel nebo už byl použit. Přihlaste se prosím znovu.',
  acctErrRateLimited: 'Příliš mnoho pokusů. Chvíli počkejte a zkuste to znovu.',
  acctErrUnauthorized: 'Vaše relace již není platná. Přihlaste se prosím znovu.',
  acctErrDeviceRevoked: 'Toto zařízení bylo odhlášeno. Přihlaste se prosím znovu.',
  acctErrRefreshReused:
    'Z bezpečnostních důvodů byla tato relace ukončena. Přihlaste se prosím znovu.',
  acctErrWrongDeployment: 'Tento účet patří jinému serveru UniWork.',
  acctErrNotConfigured: 'Tato aplikace není propojena se serverem UniWork.',
  acctErrKeyringUnavailable: 'Zabezpečené úložiště v tomto počítači není dostupné.',
  acctErrServerError: 'V UniWork došlo k problému. Zkuste to prosím později.',
  acctErrMalformedResponse: 'UniWork odeslal neočekávanou odpověď. Zkuste to prosím později.',
} satisfies Record<keyof typeof zh, string>
