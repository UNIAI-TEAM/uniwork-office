import type { zh } from './zh'

export const de = {
  // copy shared with the Home Ask UNI pane
  askUniThinking: 'UNI denkt nach…',
  askUniYou: 'Sie',
  askUniUni: 'UNI',
  askUniSources: 'Quellen',
  askUniKindDocument: 'Dokument',
  askUniKindTask: 'Aufgabe',
  askUniKindMeeting: 'Besprechung',
  askUniKindChat: 'Unterhaltung',
  askUniKindMember: 'Mitglied',
  askUniKindOther: 'Sonstiges',
  askUniOpenDocument: 'Dokument öffnen',
  askUniOpenBrowser: 'Im Browser öffnen',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniOpenFailed:
    'Diese Quelle konnte nicht geöffnet werden. Versuche es erneut oder öffne sie im Web.',
  askUniErrForbidden: 'Sie haben keinen Zugriff auf diese Daten.',
  askUniErrQuota: 'Die Organisation hat ihr KI-Token-Kontingent für diesen Monat aufgebraucht.',
  askUniErrRateLimited: 'Sie fragen zu schnell; versuchen Sie es in einer Minute erneut.',
  askUniErrRateLimitedIn: 'Sie fragen zu schnell; versuchen Sie es in {seconds} Sekunden erneut.',
  askUniErrDisabled: 'KI ist auf diesem Server nicht konfiguriert.',
  askUniErrOffline:
    'Sie sind offline. UNI fragen braucht eine Verbindung, um Dokumente zu durchsuchen.',
  askUniErrSession:
    'Ihre UniWork-Sitzung ist abgelaufen. Melden Sie sich erneut an, um weiter zu fragen.',
  askUniErrDefault: 'Die Frage ist gerade nicht möglich; versuchen Sie es später erneut.',
  askUniSignedOut:
    'Melden Sie sich bei Ihrem UniWork-Konto an, um UNI zu Ihrem Arbeitsbereich zu fragen.',
  askUniNoticeNoSources:
    'Zu dieser Frage passt noch nichts, was Sie in diesem Arbeitsbereich sehen können.',
  askUniNoticeUnavailable: 'UNI konnte diese Frage nicht beantworten.',
  askUniStop: 'Stoppen',
  askUniSend: 'Senden',
  askUniCounter: '{used}/{max} Zeichen',
  askUniPlaceholder: 'UNI zu Ihrer Arbeit fragen…',
} satisfies Record<keyof typeof zh, string>
