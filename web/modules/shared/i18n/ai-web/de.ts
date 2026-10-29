import type { zh } from './zh'

export const de = {
  aiWebClose: 'Schließen',
  aiWebStateCreditsTitle: 'KI-Credits aufgebraucht',
  aiWebStateCreditsBody:
    'Ihre Organisation hat alle UniWork-KI-Credits dieses Zeitraums verbraucht. Wenden Sie sich an Ihre Administration oder warten Sie auf die Erneuerung.',
  aiWebStateEntitlementTitle: 'KI ist nicht im Tarif',
  aiWebStateEntitlementBody:
    'Der UniWork-Tarif Ihrer Organisation enthält diese KI-Funktion nicht. Wenden Sie sich an Ihre Administration.',
  aiWebStateRateTitle: 'Zu viele KI-Anfragen',
  aiWebStateRateBody: 'Warten Sie {seconds} s und versuchen Sie es erneut.',
  aiWebStateRateBodyNow: 'Warten Sie einen Moment und versuchen Sie es erneut.',
  aiWebStateUnreachableTitle: 'KI-Anbieter nicht erreichbar',
  aiWebStateUnreachableBody:
    'UniWork konnte den KI-Anbieter nicht erreichen. Versuchen Sie es gleich noch einmal.',
  aiWebStateCloudTitle: 'Cloud-Tool nicht verfügbar',
  aiWebStateCloudBody: 'Dieses UniWork-KI-Tool ist auf dem Server noch nicht eingerichtet.',
  aiWebStateOutageTitle: 'UniWork vorübergehend nicht verfügbar',
  aiWebStateOutageBody: 'UniWork ist gerade nicht erreichbar. Versuchen Sie es gleich noch einmal.',
  aiWebStateSessionTitle: 'Sitzung abgelaufen',
  aiWebStateSessionBody: 'Öffnen Sie das Dokument erneut aus UniWork, um fortzufahren.',
  aiWebStateRefusedTitle: 'Anfrage abgelehnt',
  aiWebStateRefusedBody: 'Der Server hat die KI-Anfrage abgelehnt.',
  aiWebStateUnknownTitle: 'KI-Anfrage fehlgeschlagen',
  aiWebStateUnknownBody: 'Etwas ist schiefgelaufen. Versuchen Sie es erneut.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Diese Arbeitsmappe ist für die KI im Web zu groß. Öffnen Sie sie in der UniWork Office-App.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Mach mit dem nächsten Teil weiter.',
} satisfies Record<keyof typeof zh, string>
