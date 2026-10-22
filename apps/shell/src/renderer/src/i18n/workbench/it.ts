import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const it = {
  ...en,
  wbNotif_document_commented_untitled: '{actor} ha commentato un documento',
  wbNotif_document_mentioned: '{actor} ti ha menzionato in un commento su «{document}».',
  wbNotif_document_mentioned_untitled: '{actor} ti ha menzionato in un commento su un documento.',
  wbNotif_document_body_mentioned: '{actor} ti ha menzionato in «{document}».',
  wbNotif_document_body_mentioned_untitled: '{actor} ti ha menzionato in un documento.',
  wbNotif_document_comment_replied: '{actor} ha risposto al tuo commento in «{document}».',
  wbNotif_document_comment_replied_untitled: '{actor} ha risposto al tuo commento in un documento.',
  wbNotif_document_discussion_mentioned:
    '{actor} ti ha menzionato in una discussione su «{document}».',
  wbNotif_document_discussion_mentioned_untitled:
    '{actor} ti ha menzionato in una discussione su un documento.',
  wbNotif_document_discussion_replied:
    '{actor} ha risposto al tuo intervento nella discussione su «{document}».',
  wbNotif_document_discussion_replied_untitled:
    '{actor} ha risposto al tuo intervento nella discussione su un documento.',
  wbNotif_document_edit_requested: '{actor} vuole modificare «{document}»',
  wbNotif_document_edit_request_answered: '{actor} ti ha passato la modifica di «{document}»',
  wbNotif_document_edit_request_answered_declined: '{actor} sta ancora modificando «{document}»',
  wbNotif_document_edit_taken_over:
    '{actor} ha preso in carico la modifica di «{document}». Le tue modifiche non salvate sono ancora nel documento aperto.',
  wbNotif_document_break_glass:
    '{actor} ha aperto l’accesso di visualizzazione di emergenza (24 h) a «{document}».',
  wbNotif_document_break_glass_untitled:
    '{actor} ha aperto l’accesso di visualizzazione di emergenza (24 h) a un documento.',
  wbNotif_document_access_requested: '{actor} ha chiesto l’accesso a «{document}».',
  wbNotif_document_access_requested_untitled: '{actor} ha chiesto l’accesso a un documento.',
  wbNotif_document_access_approved: '{actor} ti ha dato accesso a «{document}».',
  wbNotif_document_access_approved_untitled: '{actor} ti ha dato accesso a un documento.',
  wbNotif_document_access_declined: 'La tua richiesta di accesso a un documento è stata rifiutata.',
  wbNotif_document_shared: '{actor} ha condiviso «{document}» con te ({level}).',
  wbNotif_document_shared_untitled: '{actor} ha condiviso un documento con te ({level}).',
  wbNotif_document_shared_nolevel: '{actor} ha condiviso «{document}» con te.',
  wbNotif_document_shared_untitled_nolevel: '{actor} ha condiviso un documento con te.',
  wbNotif_document_trashed_by_other:
    '{actor} ha spostato il tuo documento nel cestino. Ripristinalo prima del {date}',
  wbNotif_document_trashed_by_other_untitled:
    '{actor} ha spostato uno dei tuoi documenti nel cestino. Ripristinalo prima del {date}',
  wbNotif_document_trashed_by_other_nodate: '{actor} ha spostato il tuo documento nel cestino',
  wbNotif_document_trashed_by_other_untitled_nodate:
    '{actor} ha spostato uno dei tuoi documenti nel cestino',
  wbNotif_chat_call_incoming: '{actor} sta chiamando',
  wbDeskPillReply: 'Risposta',
  wbDeskPillEdit: 'In modifica',
  wbDeskPillAccess: 'Accesso',
  wbDeskPillTrash: 'Nel cestino',
  wbDeskPillBreakGlass: 'Emergenza',
  wbNotif_document_changed: '{actor} ha modificato {count} documenti',
  wbNotif_document_changed_renamed_many: '{actor} ha rinominato {count} documenti',
  wbNotif_document_changed_renamed_one: '{actor} ha rinominato “{document}”',
  wbNotif_document_changed_renamed_untitled: '{actor} ha rinominato un documento',
  wbNotif_document_changed_moved_many: '{actor} ha spostato {count} documenti',
  wbNotif_document_changed_moved_one: '{actor} ha spostato “{document}”',
  wbNotif_document_changed_moved_untitled: '{actor} ha spostato un documento',
  wbNotif_document_changed_trashed_many: '{actor} ha spostato {count} documenti nel cestino',
  wbNotif_document_changed_trashed_one: '{actor} ha spostato “{document}” nel cestino',
  wbNotif_document_changed_trashed_untitled: '{actor} ha spostato un documento nel cestino',
  wbNotif_document_changed_restored_many: '{actor} ha ripristinato {count} documenti',
  wbNotif_document_changed_restored_one: '{actor} ha ripristinato “{document}”',
  wbNotif_document_changed_restored_untitled: '{actor} ha ripristinato un documento',
  wbNotif_document_changed_deleted_many: '{actor} ha eliminato definitivamente {count} documenti',
  wbNotif_document_changed_deleted_one: '{actor} ha eliminato definitivamente “{document}”',
  wbNotif_document_changed_deleted_untitled: '{actor} ha eliminato definitivamente un documento',
  wbNotif_document_changed_shelved_many: '{actor} ha archiviato {count} documenti',
  wbNotif_document_changed_shelved_one: '{actor} ha archiviato “{document}”',
  wbNotif_document_changed_shelved_untitled: '{actor} ha archiviato un documento',
  wbNotif_document_changed_unshelved_many: '{actor} ha rimosso dall’archivio {count} documenti',
  wbNotif_document_changed_unshelved_one: '{actor} ha rimosso dall’archivio “{document}”',
  wbNotif_document_changed_unshelved_untitled: '{actor} ha rimosso dall’archivio un documento',
  wbNotif_document_changed_access_changed_many:
    '{actor} ha modificato l’accesso a {count} documenti',
  wbNotif_document_changed_access_changed_one: '{actor} ha modificato l’accesso a “{document}”',
  wbNotif_document_changed_access_changed_untitled:
    '{actor} ha modificato l’accesso a un documento',
  wbNotif_document_changed_version_created_many:
    '{actor} ha aggiunto una nuova versione a {count} documenti',
  wbNotif_document_changed_version_created_one:
    '{actor} ha aggiunto una nuova versione a “{document}”',
  wbNotif_document_changed_version_created_untitled:
    '{actor} ha aggiunto una nuova versione a un documento',
  wbNotif_document_changed_relocated_many:
    '{actor} ha spostato nel cestino la cartella che contiene {count} dei tuoi documenti; i documenti ora sono nella radice dello spazio di lavoro',
  wbNotif_document_changed_relocated_one:
    '{actor} ha spostato nel cestino la cartella che contiene “{document}”; il documento ora è nella radice dello spazio di lavoro',
  wbNotif_document_changed_relocated_untitled:
    '{actor} ha spostato nel cestino la cartella che contiene uno dei tuoi documenti; il documento ora è nella radice dello spazio di lavoro',
  wbNotif_document_changed_generic_one: '{actor} ha modificato “{document}”',
  wbNotif_document_changed_generic_untitled: '{actor} ha modificato un documento',
  wbNotif_document_comment_resolved:
    '{actor} ha contrassegnato un commento in “{document}” come risolto.',
  wbNotif_document_comment_resolved_untitled: '{actor} ha contrassegnato un commento come risolto.',
  wbDeskPillChanged: 'Modificato',
  wbDeskPillResolved: 'Risolto',
  wbDocChangeTitle: 'Documenti modificati',
  wbDocChangeLoading: 'Caricamento dei documenti',
  wbDocChangeEmptyTitle: 'Non resta nessun documento che puoi leggere',
  wbDocChangeEmptyDesc: 'Questi documenti sono stati eliminati o non hai più accesso.',
  wbDocChangeErrorTitle: 'Impossibile caricare i documenti',
  wbDocChangeErrorDesc: 'Qualcosa è andato storto, riprova',
  wbDocChangeLoadMore: 'Carica altro',
  wbDocChangeLoadingMore: 'Caricamento…',
  wbDocChangeDeleted: 'Eliminato definitivamente',
  wbDocChangeInTrash: 'Spostato nel cestino',
  wbDocChangeUntitled: 'Documento senza titolo',
  wbDocChangeMore: 'e altri {count}',
  wbNoticeNoAccess: 'Non hai accesso a questo documento.',
} satisfies Record<keyof typeof zh, string>
