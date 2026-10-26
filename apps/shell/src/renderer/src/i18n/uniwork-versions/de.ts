import type { zh } from './zh'

export const de = {
  vhsMenuEntry: 'Versionsverlauf',
  vhsTitle: 'Versionsverlauf',
  vhsDescription:
    'Die auf dem Server gespeicherten Versionen. Beim Wiederherstellen wird eine neue Version geschrieben; der Verlauf wird nie gelöscht.',
  vhsLoading: 'Verlauf wird geladen…',
  vhsError: 'Der Versionsverlauf konnte nicht geladen werden.',
  vhsRetry: 'Erneut versuchen',
  vhsEmpty: 'Noch keine Versionen. Erstellen Sie die erste Version aus der Arbeitskopie.',
  vhsLoadMore: 'Mehr laden',
  vhsRowVersion: 'Version {no}',
  vhsAuthorSystem: 'System',
  vhsAuthorFormer: 'Ehemaliges Mitglied',
  vhsAuthorAgent: 'Agent',
  vhsCurrentBadge: 'Aktuell',
  vhsView: 'Inhalt ansehen',
  vhsPreviewTitle: 'Inhalt von Version {no}',
  vhsPreviewError: 'Der Inhalt dieser Version konnte nicht geladen werden.',
  vhsPreviewEmpty: 'Diese Version hat keinen Inhalt.',
  vhsOpenUnsupported:
    'Diese Version lässt sich in der App nicht öffnen. Laden Sie sie stattdessen herunter.',
  vhsDownload: 'Diese Version herunterladen',
  vhsDownloadVersion: 'Version {no} herunterladen',
  vhsDownloadFailed: 'Die Datei konnte nicht heruntergeladen werden',
  vhsNameLabel: 'Name der Version',
  vhsNamePlaceholder: 'z. B. Vor den Änderungen aus der Prüfung',
  vhsNameHint: 'Die Version sichert die Arbeitskopie; der Name ist optional.',
  vhsNameSubmit: 'Version erstellen',
  vhsNameSubmitting: 'Wird erstellt…',
  vhsNameDone: 'Version {no} erstellt',
  vhsNameFailed: 'Die Version konnte nicht erstellt werden. Ihre Eingabe bleibt erhalten.',
  vhsNameUnchanged:
    'Seit der letzten Version hat sich nichts geändert, deshalb wurde keine neue Version erstellt.',
  vhsRestore: 'Version {no} wiederherstellen',
  vhsRestoreConfirmTitle: 'Version {no} wiederherstellen?',
  vhsRestoreConfirmDescription:
    'Die Arbeitskopie übernimmt den Inhalt dieser Version und eine neue Wiederherstellungsversion wird angehängt. Der Verlauf bleibt erhalten.',
  vhsRestoreConfirmSubmit: 'Wiederherstellen',
  vhsRestoreSubmitting: 'Wird wiederhergestellt…',
  vhsRestoreFailed: 'Wiederherstellen nicht möglich. Die Arbeitskopie ist unverändert.',
  vhsRestoreConflict:
    'Die Arbeitskopie hat sich gerade geändert. Öffnen Sie den Verlauf erneut und versuchen Sie es noch einmal.',
  vhsManageOnly: 'Zum Wiederherstellen einer Version brauchen Sie Bearbeitungsrechte.',
  vhsShelvedBlocked: 'Dieses Dokument ist archiviert und schreibgeschützt.',
  vhsLockedByOther:
    'Jemand anderes bearbeitet dieses Dokument. Warten Sie, bis die Person fertig ist, oder übernehmen Sie die Bearbeitung, und versuchen Sie es dann erneut.',
  vhsLockedByMe:
    'Sie bearbeiten dieses Dokument in einem anderen Fenster. Speichern oder schließen Sie es dort und versuchen Sie es dann erneut.',
  vhsReasonUpload: 'hochgeladen',
  vhsReasonManual: 'manuelle Version',
  vhsReasonAuto: 'automatisch',
  vhsReasonRestore: 'Wiederherstellung',
  vhsReasonAgent: 'Agent',
  vhsReasonUnknown: 'sonstige',
  vhsClose: 'Schließen',
  vhsCancel: 'Abbrechen',
} satisfies Record<keyof typeof zh, string>
