import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const de = {
  ...en,
  wbNotif_document_commented_untitled: '{actor} hat ein Dokument kommentiert',
  wbNotif_document_mentioned: '{actor} hat dich in einem Kommentar zu „{document}“ erwähnt.',
  wbNotif_document_mentioned_untitled:
    '{actor} hat dich in einem Kommentar zu einem Dokument erwähnt.',
  wbNotif_document_body_mentioned: '{actor} hat dich in „{document}“ erwähnt.',
  wbNotif_document_body_mentioned_untitled: '{actor} hat dich in einem Dokument erwähnt.',
  wbNotif_document_comment_replied: '{actor} hat auf deinen Kommentar in „{document}“ geantwortet.',
  wbNotif_document_comment_replied_untitled:
    '{actor} hat auf deinen Kommentar in einem Dokument geantwortet.',
  wbNotif_document_discussion_mentioned:
    '{actor} hat dich in einer Diskussion zu „{document}“ erwähnt.',
  wbNotif_document_discussion_mentioned_untitled:
    '{actor} hat dich in einer Diskussion zu einem Dokument erwähnt.',
  wbNotif_document_discussion_replied:
    '{actor} hat auf deinen Diskussionsbeitrag in „{document}“ geantwortet.',
  wbNotif_document_discussion_replied_untitled:
    '{actor} hat auf deinen Diskussionsbeitrag in einem Dokument geantwortet.',
  wbNotif_document_edit_requested: '{actor} möchte „{document}“ bearbeiten',
  wbNotif_document_edit_request_answered:
    '{actor} hat dir die Bearbeitung von „{document}“ übergeben',
  wbNotif_document_edit_request_answered_declined: '{actor} bearbeitet „{document}“ noch',
  wbNotif_document_edit_taken_over:
    '{actor} hat die Bearbeitung von „{document}“ übernommen. Deine nicht gespeicherten Änderungen sind weiterhin im geöffneten Dokument.',
  wbNotif_document_break_glass:
    '{actor} hat den Notfall-Lesezugriff (24 Std.) auf „{document}“ geöffnet.',
  wbNotif_document_break_glass_untitled:
    '{actor} hat den Notfall-Lesezugriff (24 Std.) auf ein Dokument geöffnet.',
  wbNotif_document_access_requested: '{actor} hat Zugriff auf „{document}“ angefragt.',
  wbNotif_document_access_requested_untitled: '{actor} hat Zugriff auf ein Dokument angefragt.',
  wbNotif_document_access_approved: '{actor} hat dir Zugriff auf „{document}“ gegeben.',
  wbNotif_document_access_approved_untitled: '{actor} hat dir Zugriff auf ein Dokument gegeben.',
  wbNotif_document_access_declined: 'Deine Zugriffsanfrage für ein Dokument wurde abgelehnt.',
  wbNotif_document_shared: '{actor} hat „{document}“ mit dir geteilt ({level}).',
  wbNotif_document_shared_untitled: '{actor} hat ein Dokument mit dir geteilt ({level}).',
  wbNotif_document_shared_nolevel: '{actor} hat „{document}“ mit dir geteilt.',
  wbNotif_document_shared_untitled_nolevel: '{actor} hat ein Dokument mit dir geteilt.',
  wbNotif_document_trashed_by_other:
    '{actor} hat dein Dokument in den Papierkorb verschoben. Stelle es vor dem {date} wieder her',
  wbNotif_document_trashed_by_other_untitled:
    '{actor} hat eins deiner Dokumente in den Papierkorb verschoben. Stelle es vor dem {date} wieder her',
  wbNotif_document_trashed_by_other_nodate:
    '{actor} hat dein Dokument in den Papierkorb verschoben',
  wbNotif_document_trashed_by_other_untitled_nodate:
    '{actor} hat eins deiner Dokumente in den Papierkorb verschoben',
  wbNotif_chat_call_incoming: '{actor} ruft an',
  wbNotifFallback: 'Neue Benachrichtigung',
  wbNotif_audit_export_ready: 'Dein Audit-Export ist fertig',
  wbNotif_chat_dm: '{actor} hat dir eine Nachricht geschickt',
  wbNotif_chat_follow_up: 'Du hast eine Nachricht zur Wiedervorlage gespeichert',
  wbNotif_chat_mentioned: '{actor} hat dich in {room} erwähnt',
  wbNotif_chat_reminder: 'Erinnerung: {body}',
  wbNotif_chat_thread_replied: '{actor} hat in {room} auf einen Thread geantwortet',
  wbNotif_document_commented: '{actor} hat „{document}“ kommentiert',
  wbNotif_email_hub_new_mail: 'Ungelesene Nachrichten: {count} · {mailbox}',
  wbNotif_meeting_invited: '{actor} hat dich zu „{meeting}“ eingeladen',
  wbNotif_meeting_starting: '„{meeting}“ beginnt in {minutes} Min.',
  wbNotif_meeting_summary_reminder:
    '„{meeting}“ ist beendet · Zusammenfassen und Aufgaben erstellen',
  wbNotif_member_added: '{actor} hat dich zum Workspace {workspace} hinzugefügt',
  wbNotif_mentioned: '{actor} hat dich in „{task}“ erwähnt',
  wbNotif_role_changed: '{actor} hat deine Rolle auf {role} geändert',
  wbNotif_task_assigned: '{actor} hat dir „{task}“ zugewiesen',
  wbNotif_task_commented: '{actor} hat „{task}“ kommentiert',
  wbNotif_task_status_changed: '{actor} hat „{task}“ auf {status} verschoben',
  wbDeskPillReply: 'Antwort',
  wbDeskPillEdit: 'Wird bearbeitet',
  wbDeskPillAccess: 'Zugriff',
  wbDeskPillTrash: 'Im Papierkorb',
  wbDeskPillBreakGlass: 'Notfall',
  wbNotif_document_changed: '{actor} hat {count} Dokumente geändert',
  wbNotif_document_changed_renamed_many: '{actor} hat {count} Dokumente umbenannt',
  wbNotif_document_changed_renamed_one: '{actor} hat “{document}” umbenannt',
  wbNotif_document_changed_renamed_untitled: '{actor} hat ein Dokument umbenannt',
  wbNotif_document_changed_moved_many: '{actor} hat {count} Dokumente verschoben',
  wbNotif_document_changed_moved_one: '{actor} hat “{document}” verschoben',
  wbNotif_document_changed_moved_untitled: '{actor} hat ein Dokument verschoben',
  wbNotif_document_changed_trashed_many:
    '{actor} hat {count} Dokumente in den Papierkorb verschoben',
  wbNotif_document_changed_trashed_one: '{actor} hat “{document}” in den Papierkorb verschoben',
  wbNotif_document_changed_trashed_untitled:
    '{actor} hat ein Dokument in den Papierkorb verschoben',
  wbNotif_document_changed_restored_many: '{actor} hat {count} Dokumente wiederhergestellt',
  wbNotif_document_changed_restored_one: '{actor} hat “{document}” wiederhergestellt',
  wbNotif_document_changed_restored_untitled: '{actor} hat ein Dokument wiederhergestellt',
  wbNotif_document_changed_deleted_many: '{actor} hat {count} Dokumente endgültig gelöscht',
  wbNotif_document_changed_deleted_one: '{actor} hat “{document}” endgültig gelöscht',
  wbNotif_document_changed_deleted_untitled: '{actor} hat ein Dokument endgültig gelöscht',
  wbNotif_document_changed_shelved_many: '{actor} hat {count} Dokumente archiviert',
  wbNotif_document_changed_shelved_one: '{actor} hat “{document}” archiviert',
  wbNotif_document_changed_shelved_untitled: '{actor} hat ein Dokument archiviert',
  wbNotif_document_changed_unshelved_many: '{actor} hat {count} Dokumente aus dem Archiv geholt',
  wbNotif_document_changed_unshelved_one: '{actor} hat “{document}” aus dem Archiv geholt',
  wbNotif_document_changed_unshelved_untitled: '{actor} hat ein Dokument aus dem Archiv geholt',
  wbNotif_document_changed_access_changed_many:
    '{actor} hat den Zugriff auf {count} Dokumente geändert',
  wbNotif_document_changed_access_changed_one: '{actor} hat den Zugriff auf “{document}” geändert',
  wbNotif_document_changed_access_changed_untitled:
    '{actor} hat den Zugriff auf ein Dokument geändert',
  wbNotif_document_changed_version_created_many:
    '{actor} hat {count} Dokumenten eine neue Version hinzugefügt',
  wbNotif_document_changed_version_created_one:
    '{actor} hat “{document}” eine neue Version hinzugefügt',
  wbNotif_document_changed_version_created_untitled:
    '{actor} hat einem Dokument eine neue Version hinzugefügt',
  wbNotif_document_changed_relocated_many:
    '{actor} hat den Ordner mit {count} Ihrer Dokumente in den Papierkorb verschoben; die Dokumente liegen jetzt im Stammverzeichnis des Arbeitsbereichs',
  wbNotif_document_changed_relocated_one:
    '{actor} hat den Ordner mit “{document}” in den Papierkorb verschoben; das Dokument liegt jetzt im Stammverzeichnis des Arbeitsbereichs',
  wbNotif_document_changed_relocated_untitled:
    '{actor} hat den Ordner mit einem Ihrer Dokumente in den Papierkorb verschoben; das Dokument liegt jetzt im Stammverzeichnis des Arbeitsbereichs',
  wbNotif_document_changed_generic_one: '{actor} hat “{document}” geändert',
  wbNotif_document_changed_generic_untitled: '{actor} hat ein Dokument geändert',
  wbNotif_document_comment_resolved:
    '{actor} hat einen Kommentar in “{document}” als gelöst markiert.',
  wbNotif_document_comment_resolved_untitled: '{actor} hat einen Kommentar als gelöst markiert.',
  wbDeskPillChanged: 'Geändert',
  wbDeskPillResolved: 'Gelöst',
  wbDocChangeTitle: 'Geänderte Dokumente',
  wbDocChangeLoading: 'Dokumente werden geladen',
  wbDocChangeEmptyTitle: 'Kein lesbares Dokument mehr vorhanden',
  wbDocChangeEmptyDesc: 'Diese Dokumente wurden gelöscht oder Sie haben keinen Zugriff mehr.',
  wbDocChangeErrorTitle: 'Dokumente konnten nicht geladen werden',
  wbDocChangeErrorDesc: 'Etwas ist schiefgelaufen, versuchen Sie es erneut',
  wbDocChangeLoadMore: 'Mehr laden',
  wbDocChangeLoadingMore: 'Wird geladen…',
  wbDocChangeDeleted: 'Endgültig gelöscht',
  wbDocChangeInTrash: 'In den Papierkorb verschoben',
  wbDocChangeUntitled: 'Unbenanntes Dokument',
  wbDocChangeMore: 'und {count} weitere',
  wbNoticeNoAccess: 'Sie haben keinen Zugriff auf dieses Dokument.',
  wbTabCountUnread: 'Ungelesene Benachrichtigungen: {count}',
} satisfies Record<keyof typeof zh, string>
