import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const nl = {
  ...en,
  wbNotif_document_commented_untitled: '{actor} heeft een document becommentarieerd',
  wbNotif_document_mentioned: '{actor} heeft je genoemd in een reactie op “{document}”.',
  wbNotif_document_mentioned_untitled: '{actor} heeft je genoemd in een reactie op een document.',
  wbNotif_document_body_mentioned: '{actor} heeft je genoemd in “{document}”.',
  wbNotif_document_body_mentioned_untitled: '{actor} heeft je genoemd in een document.',
  wbNotif_document_comment_replied: '{actor} heeft gereageerd op je reactie in “{document}”.',
  wbNotif_document_comment_replied_untitled:
    '{actor} heeft gereageerd op je reactie in een document.',
  wbNotif_document_discussion_mentioned:
    '{actor} heeft je genoemd in een discussie over “{document}”.',
  wbNotif_document_discussion_mentioned_untitled:
    '{actor} heeft je genoemd in een discussie over een document.',
  wbNotif_document_discussion_replied:
    '{actor} heeft gereageerd op je bericht in de discussie over “{document}”.',
  wbNotif_document_discussion_replied_untitled:
    '{actor} heeft gereageerd op je bericht in de discussie over een document.',
  wbNotif_document_edit_requested: '{actor} wil “{document}” bewerken',
  wbNotif_document_edit_request_answered:
    '{actor} heeft het bewerken van “{document}” aan jou overgedragen',
  wbNotif_document_edit_request_answered_declined:
    '{actor} is “{document}” nog steeds aan het bewerken',
  wbNotif_document_edit_taken_over:
    '{actor} heeft het bewerken van “{document}” overgenomen. Je niet-opgeslagen wijzigingen staan nog in het geopende document.',
  wbNotif_document_break_glass:
    '{actor} heeft noodtoegang tot alleen-lezen (24 u) tot “{document}” geopend.',
  wbNotif_document_break_glass_untitled:
    '{actor} heeft noodtoegang tot alleen-lezen (24 u) tot een document geopend.',
  wbNotif_document_access_requested: '{actor} heeft toegang tot “{document}” aangevraagd.',
  wbNotif_document_access_requested_untitled: '{actor} heeft toegang tot een document aangevraagd.',
  wbNotif_document_access_approved: '{actor} heeft je toegang tot “{document}” gegeven.',
  wbNotif_document_access_approved_untitled: '{actor} heeft je toegang tot een document gegeven.',
  wbNotif_document_access_declined: 'Je verzoek om toegang tot een document is afgewezen.',
  wbNotif_document_shared: '{actor} heeft “{document}” met je gedeeld ({level}).',
  wbNotif_document_shared_untitled: '{actor} heeft een document met je gedeeld ({level}).',
  wbNotif_document_shared_nolevel: '{actor} heeft “{document}” met je gedeeld.',
  wbNotif_document_shared_untitled_nolevel: '{actor} heeft een document met je gedeeld.',
  wbNotif_document_shared_folder:
    '{actor} heeft {count} document(en) in de map “{document}” met je gedeeld ({level}).',
  wbNotif_document_shared_folder_untitled:
    '{actor} heeft {count} document(en) in een map met je gedeeld ({level}).',
  wbNotif_document_shared_folder_nolevel:
    '{actor} heeft {count} document(en) in de map “{document}” met je gedeeld.',
  wbNotif_document_shared_folder_untitled_nolevel:
    '{actor} heeft {count} document(en) in een map met je gedeeld.',
  wbNotif_document_owner_transferred:
    '{actor} heeft het eigendom van “{document}” aan je overgedragen.',
  wbNotif_document_owner_transferred_untitled:
    '{actor} heeft het eigendom van een document aan je overgedragen.',
  wbNotif_document_trashed_by_other:
    '{actor} heeft je document naar de prullenbak verplaatst. Zet het terug vóór {date}',
  wbNotif_document_trashed_by_other_untitled:
    '{actor} heeft een van je documenten naar de prullenbak verplaatst. Zet het terug vóór {date}',
  wbNotif_document_trashed_by_other_nodate:
    '{actor} heeft je document naar de prullenbak verplaatst',
  wbNotif_document_trashed_by_other_untitled_nodate:
    '{actor} heeft een van je documenten naar de prullenbak verplaatst',
  wbNotif_chat_call_incoming: '{actor} belt',
  wbNotifFallback: 'Nieuwe melding',
  wbNotif_audit_export_ready: 'Je auditexport is klaar',
  wbNotif_chat_dm: '{actor} heeft je een bericht gestuurd',
  wbNotif_chat_follow_up: 'Je hebt een opvolging voor een bericht opgeslagen',
  wbNotif_chat_mentioned: '{actor} heeft je genoemd in {room}',
  wbNotif_chat_reminder: 'Herinnering: {body}',
  wbNotif_chat_thread_replied: '{actor} heeft gereageerd op een draad in {room}',
  wbNotif_document_commented: '{actor} heeft gereageerd op “{document}”',
  wbNotif_email_hub_new_mail: 'Ongelezen berichten: {count} · {mailbox}',
  wbNotif_meeting_invited: '{actor} heeft je uitgenodigd voor “{meeting}”',
  wbNotif_meeting_starting: '“{meeting}” begint over {minutes} min',
  wbNotif_meeting_summary_reminder: '“{meeting}” is afgelopen · Vat samen en maak taken aan',
  wbNotif_member_added: '{actor} heeft je toegevoegd aan werkruimte {workspace}',
  wbNotif_mentioned: '{actor} heeft je genoemd in “{task}”',
  wbNotif_role_changed: '{actor} heeft je rol gewijzigd in {role}',
  wbNotif_task_assigned: '{actor} heeft “{task}” aan je toegewezen',
  wbNotif_task_commented: '{actor} heeft gereageerd op “{task}”',
  wbNotif_task_status_changed: '{actor} heeft “{task}” naar {status} verplaatst',
  wbDeskPillComment: 'Opmerking',
  wbDeskPillMention: 'Vermelding',
  wbDeskPillShared: 'Nieuw gedeeld',
  wbDeskPillReply: 'Antwoord',
  wbDeskPillEdit: 'Bewerken',
  wbDeskPillAccess: 'Toegang',
  wbDeskPillTrash: 'In prullenbak',
  wbDeskPillBreakGlass: 'Nood',
  wbNotif_document_changed: '{actor} heeft {count} documenten gewijzigd',
  wbNotif_document_changed_renamed_many: '{actor} heeft {count} documenten hernoemd',
  wbNotif_document_changed_renamed_one: '{actor} heeft “{document}” hernoemd',
  wbNotif_document_changed_renamed_untitled: '{actor} heeft een document hernoemd',
  wbNotif_document_changed_moved_many: '{actor} heeft {count} documenten verplaatst',
  wbNotif_document_changed_moved_one: '{actor} heeft “{document}” verplaatst',
  wbNotif_document_changed_moved_untitled: '{actor} heeft een document verplaatst',
  wbNotif_document_changed_trashed_many:
    '{actor} heeft {count} documenten naar de prullenbak verplaatst',
  wbNotif_document_changed_trashed_one: '{actor} heeft “{document}” naar de prullenbak verplaatst',
  wbNotif_document_changed_trashed_untitled:
    '{actor} heeft een document naar de prullenbak verplaatst',
  wbNotif_document_changed_restored_many: '{actor} heeft {count} documenten hersteld',
  wbNotif_document_changed_restored_one: '{actor} heeft “{document}” hersteld',
  wbNotif_document_changed_restored_untitled: '{actor} heeft een document hersteld',
  wbNotif_document_changed_deleted_many: '{actor} heeft {count} documenten definitief verwijderd',
  wbNotif_document_changed_deleted_one: '{actor} heeft “{document}” definitief verwijderd',
  wbNotif_document_changed_deleted_untitled: '{actor} heeft een document definitief verwijderd',
  wbNotif_document_changed_shelved_many: '{actor} heeft {count} documenten gearchiveerd',
  wbNotif_document_changed_shelved_one: '{actor} heeft “{document}” gearchiveerd',
  wbNotif_document_changed_shelved_untitled: '{actor} heeft een document gearchiveerd',
  wbNotif_document_changed_unshelved_many:
    '{actor} heeft {count} documenten uit het archief gehaald',
  wbNotif_document_changed_unshelved_one: '{actor} heeft “{document}” uit het archief gehaald',
  wbNotif_document_changed_unshelved_untitled: '{actor} heeft een document uit het archief gehaald',
  wbNotif_document_changed_access_changed_many:
    '{actor} heeft de toegang tot {count} documenten gewijzigd',
  wbNotif_document_changed_access_changed_one:
    '{actor} heeft de toegang tot “{document}” gewijzigd',
  wbNotif_document_changed_access_changed_untitled:
    '{actor} heeft de toegang tot een document gewijzigd',
  wbNotif_document_changed_version_created_many:
    '{actor} heeft een nieuwe versie toegevoegd aan {count} documenten',
  wbNotif_document_changed_version_created_one:
    '{actor} heeft een nieuwe versie toegevoegd aan “{document}”',
  wbNotif_document_changed_version_created_untitled:
    '{actor} heeft een nieuwe versie toegevoegd aan een document',
  wbNotif_document_changed_relocated_many:
    '{actor} heeft de map met {count} van je documenten naar de prullenbak verplaatst; de documenten staan nu in de hoofdmap van de werkruimte',
  wbNotif_document_changed_relocated_one:
    '{actor} heeft de map met “{document}” naar de prullenbak verplaatst; het document staat nu in de hoofdmap van de werkruimte',
  wbNotif_document_changed_relocated_untitled:
    '{actor} heeft de map met een van je documenten naar de prullenbak verplaatst; het document staat nu in de hoofdmap van de werkruimte',
  wbNotif_document_changed_generic_one: '{actor} heeft “{document}” gewijzigd',
  wbNotif_document_changed_generic_untitled: '{actor} heeft een document gewijzigd',
  wbNotif_document_comment_resolved:
    '{actor} heeft een reactie in “{document}” als opgelost gemarkeerd.',
  wbNotif_document_comment_resolved_untitled: '{actor} heeft een reactie als opgelost gemarkeerd.',
  wbDeskPillChanged: 'Gewijzigd',
  wbDeskPillResolved: 'Opgelost',
  wbDocChangeTitle: 'Gewijzigde documenten',
  wbDocChangeLoading: 'Documenten laden',
  wbDocChangeEmptyTitle: 'Geen document meer dat je kunt lezen',
  wbDocChangeEmptyDesc: 'Deze documenten zijn verwijderd of je hebt geen toegang meer.',
  wbDocChangeErrorTitle: 'De documenten konden niet worden geladen',
  wbDocChangeErrorDesc: 'Er ging iets mis, probeer het opnieuw',
  wbDocChangeLoadMore: 'Meer laden',
  wbDocChangeLoadingMore: 'Laden…',
  wbDocChangeDeleted: 'Definitief verwijderd',
  wbDocChangeInTrash: 'Naar de prullenbak verplaatst',
  wbDocChangeUntitled: 'Naamloos document',
  wbDocChangeMore: 'en {count} meer',
  wbNoticeNoAccess: 'Je hebt geen toegang tot dit document.',
  wbTabCountUnread: 'Ongelezen meldingen: {count}',
} satisfies Record<keyof typeof zh, string>
