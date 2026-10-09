import type { zh } from './zh'

export const de = {
  acctTitle: 'UniWork-Konto',
  acctOpenSettings: 'Kontoeinstellungen öffnen',
  acctSignIn: 'Anmelden',
  acctSignInUniwork: 'Bei UniWork anmelden',
  acctSignInAgain: 'Erneut anmelden',
  acctSignOut: 'Abmelden',
  acctSigningOut: 'Abmeldung läuft…',
  acctSigningIn: 'Anmeldung läuft…',
  acctSigningInHint: 'Fahren Sie in Ihrem Browser fort, um die Anmeldung abzuschließen.',
  acctCancel: 'Abbrechen',
  acctOpenAgain: 'Browser erneut öffnen',
  acctCopyLink: 'Anmeldelink kopieren',
  acctLinkCopied: 'Link kopiert',
  acctSignedInAs: 'Angemeldet als {name}',
  acctSignedOutTitle: 'Sie sind nicht angemeldet',
  acctSignedOutBody:
    'Melden Sie sich mit Ihrem UniWork-Konto an, um den Tarif Ihrer Organisation auf diesem Gerät zu nutzen.',
  acctRefreshing: 'Konto wird aktualisiert…',
  acctName: 'Name',
  acctEmail: 'E-Mail',
  acctOrg: 'Organisation',
  acctPlan: 'Tarif',
  acctServer: 'Server',
  acctNoPlan: 'Kein Tarif',
  acctSwitchOrg: 'Organisation wechseln',
  acctSwitchOrgFailed:
    'Die Organisation konnte nicht gewechselt werden. Bitte versuchen Sie es erneut.',
  acctExpiredShort: 'Sitzung abgelaufen',
  acctExpiredTitle: 'Ihre Sitzung ist abgelaufen',
  acctExpiredBody:
    'Melden Sie sich aus Sicherheitsgründen erneut an, um Ihr UniWork-Konto weiter zu verwenden.',
  acctRevokedShort: 'Sitzung beendet',
  acctRevokedTitle: 'Sie wurden auf diesem Gerät abgemeldet',
  acctRevokedBody:
    'Die Sitzung dieses Geräts wurde von einem anderen Gerät oder von einem Administrator beendet. Melden Sie sich erneut an, um fortzufahren.',
  acctUnreachableTitle: 'UniWork ist nicht erreichbar',
  acctUnreachableBody:
    'Prüfen Sie Ihre Internetverbindung oder Proxy-Einstellungen. Sie sind weiterhin angemeldet; die folgenden Angaben sind möglicherweise veraltet.',
  acctRetry: 'Erneut versuchen',
  acctRetrying: 'Neuer Versuch…',
  acctWrongServerShort: 'Anderer Server',
  acctWrongServerTitle: 'Bei einem anderen Server angemeldet',
  acctWrongServerBody:
    'Diese App ist mit {server} verknüpft, Ihre Sitzung gehört jedoch zu einem anderen UniWork-Server. Melden Sie sich erneut bei {server} an oder melden Sie sich ab.',
  acctThisServer: 'dem konfigurierten Server',
  acctNotConfiguredShort: 'Nicht verknüpft',
  acctNotConfiguredTitle: 'Nicht mit einem UniWork-Server verknüpft',
  acctNotConfiguredBody:
    'Diese Kopie von UniWork Office ist noch nicht mit einem UniWork-Server eingerichtet, daher ist die Anmeldung nicht verfügbar. Fragen Sie Ihren Administrator nach einem konfigurierten Installationsprogramm.',
  acctKeyringShort: 'Sicherer Speicher erforderlich',
  acctKeyringTitle: 'Der sichere Speicher ist nicht verfügbar',
  acctKeyringBody:
    'UniWork Office speichert Ihre Anmeldedaten im sicheren Speicher Ihres Systems (Schlüsselbund, Anmeldeinformationsverwaltung oder Keyring). Entsperren oder richten Sie ihn ein und starten Sie die App anschließend neu.',
  acctErrLaunch: 'Die Anmeldung konnte nicht gestartet werden. Bitte versuchen Sie es erneut.',
  acctErrNetwork:
    'Verbindung zu UniWork nicht möglich. Prüfen Sie Ihre Internetverbindung oder Proxy-Einstellungen.',
  acctErrTimeout: 'UniWork hat zu lange nicht geantwortet. Bitte versuchen Sie es erneut.',
  acctErrLoginTimeout: 'Zeitüberschreitung bei der Anmeldung. Bitte versuchen Sie es erneut.',
  acctErrCancelled: 'Die Anmeldung wurde abgebrochen.',
  acctErrInvalidCallback: 'Die Anmeldeantwort war ungültig. Bitte versuchen Sie es erneut.',
  acctErrStateMismatch:
    'Dieser Anmeldelink passt nicht zum aktuellen Anmeldeversuch. Starten Sie die Anmeldung erneut in der App.',
  acctCallbackMismatch:
    'Dieser Anmeldelink passt nicht. Schließen Sie die Anmeldung in dem Browserfenster ab, das diese App geöffnet hat.',
  acctErrAuthCodeInvalid:
    'Der Anmeldecode ist abgelaufen oder wurde bereits verwendet. Bitte melden Sie sich erneut an.',
  acctErrRateLimited:
    'Zu viele Versuche. Warten Sie einen Moment und versuchen Sie es dann erneut.',
  acctErrUnauthorized: 'Ihre Sitzung ist nicht mehr gültig. Bitte melden Sie sich erneut an.',
  acctErrDeviceRevoked: 'Dieses Gerät wurde abgemeldet. Bitte melden Sie sich erneut an.',
  acctErrRefreshReused:
    'Aus Sicherheitsgründen wurde diese Sitzung beendet. Bitte melden Sie sich erneut an.',
  acctErrWrongDeployment: 'Dieses Konto gehört zu einem anderen UniWork-Server.',
  acctErrNotConfigured: 'Diese App ist nicht mit einem UniWork-Server verknüpft.',
  acctErrKeyringUnavailable: 'Der sichere Speicher auf diesem Computer ist nicht verfügbar.',
  acctErrServerError:
    'Bei UniWork ist ein Problem aufgetreten. Bitte versuchen Sie es später erneut.',
  acctErrMalformedResponse:
    'UniWork hat eine unerwartete Antwort gesendet. Bitte versuchen Sie es später erneut.',
} satisfies Record<keyof typeof zh, string>
