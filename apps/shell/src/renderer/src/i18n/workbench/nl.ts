import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const nl = {
  ...en,
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
} satisfies Record<keyof typeof zh, string>
