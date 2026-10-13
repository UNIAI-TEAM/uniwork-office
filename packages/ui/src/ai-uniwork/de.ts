import type { zh } from './zh'

export const de = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Verbleibende Credits: {remaining} von {limit}',
  aiUniworkFooterSignIn: 'Melden Sie sich bei UniWork an, um UniWork AI zu nutzen',
  aiUniworkSignedOut:
    'Sie sind von UniWork abgemeldet. Wählen Sie einen anderen Anbieter oder melden Sie sich erneut an.',
  aiUniworkOff:
    'UniWork AI ist für dieses Dokument deaktiviert. Wählen Sie einen anderen Anbieter.',
  aiUniworkViewOnly:
    'Nur Ansicht: Die KI kann antworten, aber das Dokument weder bearbeiten noch speichern.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI liest, was in diesem Dokument geöffnet ist, auch ungespeicherte Änderungen, und sendet es zur Beantwortung an UniWork und den Modellanbieter. Jeder Lauf verbraucht KI-Credits von {org}. Die KI speichert nie für Sie: prüfen Sie und drücken Sie dann Speichern.',
  aiUniworkDisclosureLabel: 'Was UniWork AI erhält',
  aiUniworkDisclosureShort:
    'Sendet geöffnete Inhalte (auch ungespeicherte) an UniWork · Credits von {org}',
  aiUniworkLocalFile:
    'Diese Datei liegt auf Ihrem Computer, nicht in UniWork. Mit UniWork AI wird der Inhalt der geöffneten Datei an UniWork gesendet und verbraucht KI-Credits von {org}. Die Datei wird nicht als UniWork-Dokument hochgeladen.',
  aiUniworkAck: 'Verstanden',
  aiUniworkLearnMore: 'Mehr erfahren',
  aiUniworkDetails: 'Details',
  aiUniworkSendNeedsAck: 'Lesen und bestätigen Sie den Hinweis vor dem Senden.',

  // S9 result chips and run controls
  aiResultAnswer: 'Antwort',
  aiResultClarify: 'Rückfrage nötig',
  aiResultEdited: 'Im Dokument bearbeitet',
  aiResultUnsupported: 'Nicht unterstützt',
  aiResultError: 'Fehler',
  aiResultEditedHint:
    'Nicht gespeichert – mit Strg/⌘+Z rückgängig machen oder Speichern drücken, wenn es passt.',
  aiResultViewChanges: 'Änderungen anzeigen',
  aiRunStop: 'Stoppen',
  aiRunSend: 'Senden',
  aiRunRunning: 'Läuft… Drücken Sie Stoppen oder Esc zum Anhalten.',
  aiRunStopped:
    'Gestoppt. Bereits angewendete Änderungen bleiben im Dokument und lassen sich rückgängig machen.',
  aiRunAskAgain: 'Erneut fragen',
  aiRunChooseOther: 'Anderen Anbieter wählen',
  aiRunOpenInApp: 'In der App öffnen',
  aiConversationRestarted:
    'Die vorherige Unterhaltung ist abgelaufen, daher hat UniWork AI eine neue begonnen und erinnert sich nicht mehr an frühere Beiträge. Senden Sie Ihre Frage erneut, um fortzufahren.',
  aiConversationBoundary:
    'Neue Unterhaltung mit {provider}: Die Beiträge oben werden nicht mitgesendet.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Dieser Lauf hat das Schrittlimit von UniWork AI erreicht. Bisherige Ergebnisse bleiben erhalten; teilen Sie die Anfrage auf und fragen Sie erneut.',
  aiErrCredits:
    'Ihre Organisation hat für diesen Zeitraum keine KI-Credits mehr. Dieser Lauf wurde gestoppt.',
  aiErrEntitlement: 'Der Tarif Ihrer Organisation umfasst UniWork AI nicht mehr.',
  aiErrRateLimited: 'Sie senden zu schnell. Versuchen Sie es in {seconds} s erneut.',
  aiErrRateLimitedNoWait: 'Sie senden zu schnell. Versuchen Sie es in ein paar Minuten erneut.',
  aiErrUnavailable:
    'UniWork AI antwortet gerade nicht. Ihr Dokument und Speichern funktionieren weiterhin.',
  aiErrDisconnected:
    'Die Verbindung wurde unterbrochen, daher wurde dieser Lauf gestoppt. Bereits angewendete Änderungen bleiben im Dokument und lassen sich rückgängig machen.',
  aiErrOffline:
    'Sie sind offline. UniWork AI läuft nicht offline, und Anfragen werden nicht in die Warteschlange gestellt.',
  aiErrSession:
    'Ihre UniWork-Sitzung ist abgelaufen, daher wurde dieser Lauf gestoppt. Melden Sie sich erneut an, um fortzufahren.',
  aiErrRevoked:
    'Sie haben keinen Zugriff mehr auf dieses Dokument, daher wurde der KI-Lauf gestoppt.',
  aiErrDowngraded:
    'Ihr Zugriff wurde gerade auf „Nur Ansicht“ geändert, daher bearbeitet die KI nicht mehr. Antworten gehen weiter.',
  aiErrCapabilityOff:
    'UniWork AI wurde für dieses Dokument gerade deaktiviert, daher wurde der Lauf nach dem aktuellen Schritt gestoppt.',
  aiErrUnsupported: 'UniWork AI kann dies in {module} noch nicht.',
  aiErrViewOnlyEdit:
    'Sie haben nur Lesezugriff auf dieses Dokument, daher kann die KI es nicht bearbeiten.',
} satisfies Record<keyof typeof zh, string>
