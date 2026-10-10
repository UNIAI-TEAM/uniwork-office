import type { zh } from './zh'

export const de = {
  aiWebSettingsTitle: 'KI-Einstellungen',
  aiWebSettingsIntro:
    'Der Assistent verwendet Ihren eigenen API-Schlüssel des Anbieters. UniWork speichert ihn verschlüsselt; der Schlüssel wird nie an diese Seite gesendet.',
  aiWebProvider: 'Anbieter',
  aiWebModel: 'Modell',
  aiWebKeySaved: 'Gespeicherter Schlüssel {hint}',
  aiWebNoKey: 'Kein Schlüssel gespeichert',
  aiWebApiKey: 'API-Schlüssel',
  aiWebApiKeyKeep: 'Neuer API-Schlüssel (leer lassen, um den gespeicherten zu behalten)',
  aiWebBaseUrl: 'Basis-URL',
  aiWebSaveKey: 'Schlüssel speichern',
  aiWebRemoveKey: 'Schlüssel entfernen',
  aiWebDone: 'Fertig',
  aiWebLoading: 'Wird geladen…',
  aiWebLoadFailed: 'KI-Einstellungen konnten nicht geladen werden. Versuchen Sie es später erneut.',
  aiWebCloudTitle: 'UniWork-KI-Cloud-Tools',
  aiWebCloudOff: 'Nicht im Tarif Ihrer Organisation enthalten',
  aiWebCredits: 'Verbleibende Credits: {remaining} von {limit}',
  aiWebCreditsUnlimited: 'Credits: unbegrenzt',
  aiWebCreditsRenew: 'Erneuerung am {date}',
  aiWebOpenSettings: 'KI-Einstellungen',
  aiWebClose: 'Schließen',
  aiWebStateCreditsTitle: 'KI-Credits aufgebraucht',
  aiWebStateCreditsBody:
    'Ihre Organisation hat alle UniWork-KI-Credits dieses Zeitraums verbraucht. Wenden Sie sich an Ihre Administration oder warten Sie auf die Erneuerung.',
  aiWebStateEntitlementTitle: 'KI ist nicht im Tarif',
  aiWebStateEntitlementBody:
    'Der UniWork-Tarif Ihrer Organisation enthält diese KI-Funktion nicht. Wenden Sie sich an Ihre Administration.',
  aiWebStateKeyMissingTitle: 'Noch kein KI-Schlüssel',
  aiWebStateKeyMissingBody:
    'Fügen Sie in den KI-Einstellungen einen API-Schlüssel hinzu, um den Assistenten zu nutzen.',
  aiWebStateKeyRejectedTitle: 'Der KI-Schlüssel wurde abgelehnt',
  aiWebStateKeyRejectedBody:
    'Der Anbieter hat den gespeicherten Schlüssel abgelehnt. Ersetzen Sie ihn in den KI-Einstellungen.',
  aiWebStateRateTitle: 'Zu viele KI-Anfragen',
  aiWebStateRateBody: 'Warten Sie {seconds} s und versuchen Sie es erneut.',
  aiWebStateRateBodyNow: 'Warten Sie einen Moment und versuchen Sie es erneut.',
  aiWebStateUnreachableTitle: 'KI-Anbieter nicht erreichbar',
  aiWebStateUnreachableBody:
    'UniWork konnte den KI-Anbieter nicht erreichen. Versuchen Sie es gleich noch einmal.',
  aiWebStateCloudTitle: 'Cloud-Tool nicht verfügbar',
  aiWebStateCloudBody: 'Dieses UniWork-KI-Tool ist auf dem Server noch nicht eingerichtet.',
  aiWebStateSessionTitle: 'Sitzung abgelaufen',
  aiWebStateSessionBody: 'Öffnen Sie das Dokument erneut aus UniWork, um fortzufahren.',
  aiWebStateRefusedTitle: 'Anfrage abgelehnt',
  aiWebStateRefusedBody: 'Der Server hat die KI-Anfrage abgelehnt.',
  aiWebStateModelTitle: 'Modell auswählen',
  aiWebStateModelBody:
    'Wählen Sie im Modellmenü neben dem Nachrichtenfeld ein Modell aus und senden Sie erneut.',
  aiWebStateBaseUrlBody:
    'Diese Basis-URL ist nicht erlaubt. Verwenden Sie eine öffentliche https://-Adresse.',
  aiWebStateProviderBody: 'Dieser Anbieter wird nicht unterstützt.',
  aiWebStateUnknownTitle: 'KI-Anfrage fehlgeschlagen',
  aiWebStateUnknownBody: 'Etwas ist schiefgelaufen. Versuchen Sie es erneut.',
} satisfies Record<keyof typeof zh, string>
