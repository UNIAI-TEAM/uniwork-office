import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const de = {
  ...en,
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
} satisfies Record<keyof typeof zh, string>
