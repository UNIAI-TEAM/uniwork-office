import type { zh } from './zh'

export const de = {
  askUniModeGroup: 'Modus',
  askUniModeChat: 'Assistent',
  askUniModeAsk: 'UNI fragen',
  askUniTitle: 'UNI fragen',
  askUniDescription:
    'UNI antwortet nur anhand von Daten, die Sie in diesem Arbeitsbereich sehen können, und nennt die Quellen.',
  askUniWorkspace: 'Arbeitsbereich',
  askUniEmptyTitle: 'Was möchten Sie über die Arbeit des Teams wissen?',
  askUniEmptyDescription:
    'UNI liest Aufgaben, Besprechungen, Unterhaltungen, an denen Sie beteiligt sind, und Mitglieder — Antworten nennen immer ihre Quellen.',
  askUniPlaceholder: 'UNI zu Ihrer Arbeit fragen…',
  askUniSend: 'Senden',
  askUniStop: 'Stoppen',
  askUniStopped: 'Gestoppt. Die Antwort wird nicht angezeigt.',
  askUniThinking: 'UNI denkt nach…',
  askUniNewChat: 'Neue Unterhaltung',
  askUniYou: 'Sie',
  askUniUni: 'UNI',
  askUniSources: 'Quellen',
  askUniKindDocument: 'Dokument',
  askUniKindTask: 'Aufgabe',
  askUniKindMeeting: 'Besprechung',
  askUniKindChat: 'Unterhaltung',
  askUniKindMember: 'Mitglied',
  askUniOpenDocument: 'Dokument öffnen',
  askUniKindOther: 'Sonstiges',
  askUniOpenBrowser: 'Im Browser öffnen',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniCounter: '{used}/{max} Zeichen',
  askUniLoading: 'Wird geladen…',
  askUniSignedOut:
    'Melden Sie sich bei Ihrem UniWork-Konto an, um UNI zu Ihrem Arbeitsbereich zu fragen.',
  askUniNoWorkspace: 'Ihr Konto hat noch keinen Arbeitsbereich, zu dem Sie fragen können.',
  askUniNoticeNoSources:
    'Zu dieser Frage passt noch nichts, was Sie in diesem Arbeitsbereich sehen können.',
  askUniNoticeUnavailable: 'UNI konnte diese Frage nicht beantworten.',
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
  askUniOpenFailed:
    'Diese Quelle konnte nicht geöffnet werden. Versuche es erneut oder öffne sie im Web.',
} satisfies Record<keyof typeof zh, string>
