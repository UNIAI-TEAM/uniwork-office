import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const fr = {
  ...en,
  wbNotif_document_changed: '{actor} a modifié {count} documents',
  wbNotif_document_changed_renamed_many: '{actor} a renommé {count} documents',
  wbNotif_document_changed_renamed_one: '{actor} a renommé “{document}”',
  wbNotif_document_changed_renamed_untitled: '{actor} a renommé un document',
  wbNotif_document_changed_moved_many: '{actor} a déplacé {count} documents',
  wbNotif_document_changed_moved_one: '{actor} a déplacé “{document}”',
  wbNotif_document_changed_moved_untitled: '{actor} a déplacé un document',
  wbNotif_document_changed_trashed_many: '{actor} a mis {count} documents à la corbeille',
  wbNotif_document_changed_trashed_one: '{actor} a mis “{document}” à la corbeille',
  wbNotif_document_changed_trashed_untitled: '{actor} a mis un document à la corbeille',
  wbNotif_document_changed_restored_many: '{actor} a restauré {count} documents',
  wbNotif_document_changed_restored_one: '{actor} a restauré “{document}”',
  wbNotif_document_changed_restored_untitled: '{actor} a restauré un document',
  wbNotif_document_changed_deleted_many: '{actor} a supprimé définitivement {count} documents',
  wbNotif_document_changed_deleted_one: '{actor} a supprimé définitivement “{document}”',
  wbNotif_document_changed_deleted_untitled: '{actor} a supprimé définitivement un document',
  wbNotif_document_changed_shelved_many: '{actor} a archivé {count} documents',
  wbNotif_document_changed_shelved_one: '{actor} a archivé “{document}”',
  wbNotif_document_changed_shelved_untitled: '{actor} a archivé un document',
  wbNotif_document_changed_unshelved_many: '{actor} a désarchivé {count} documents',
  wbNotif_document_changed_unshelved_one: '{actor} a désarchivé “{document}”',
  wbNotif_document_changed_unshelved_untitled: '{actor} a désarchivé un document',
  wbNotif_document_changed_access_changed_many: "{actor} a modifié l'accès à {count} documents",
  wbNotif_document_changed_access_changed_one: "{actor} a modifié l'accès à “{document}”",
  wbNotif_document_changed_access_changed_untitled: "{actor} a modifié l'accès à un document",
  wbNotif_document_changed_version_created_many:
    '{actor} a ajouté une nouvelle version à {count} documents',
  wbNotif_document_changed_version_created_one:
    '{actor} a ajouté une nouvelle version à “{document}”',
  wbNotif_document_changed_version_created_untitled:
    '{actor} a ajouté une nouvelle version à un document',
  wbNotif_document_changed_relocated_many:
    "{actor} a mis à la corbeille le dossier contenant {count} de vos documents ; les documents sont maintenant à la racine de l'espace de travail",
  wbNotif_document_changed_relocated_one:
    "{actor} a mis à la corbeille le dossier contenant “{document}” ; le document est maintenant à la racine de l'espace de travail",
  wbNotif_document_changed_relocated_untitled:
    "{actor} a mis à la corbeille le dossier contenant l'un de vos documents ; le document est maintenant à la racine de l'espace de travail",
  wbNotif_document_changed_generic_one: '{actor} a modifié “{document}”',
  wbNotif_document_changed_generic_untitled: '{actor} a modifié un document',
  wbNotif_document_comment_resolved:
    '{actor} a marqué un commentaire dans “{document}” comme résolu.',
  wbNotif_document_comment_resolved_untitled: '{actor} a marqué un commentaire comme résolu.',
  wbDeskPillChanged: 'Modifié',
  wbDeskPillResolved: 'Résolu',
  wbDocChangeTitle: 'Documents modifiés',
  wbDocChangeLoading: 'Chargement des documents',
  wbDocChangeEmptyTitle: 'Il ne reste aucun document que vous pouvez lire',
  wbDocChangeEmptyDesc: "Ces documents ont été supprimés ou vous n'y avez plus accès.",
  wbDocChangeErrorTitle: 'Impossible de charger les documents',
  wbDocChangeErrorDesc: "Une erreur s'est produite, réessayez",
  wbDocChangeLoadMore: 'Afficher plus',
  wbDocChangeLoadingMore: 'Chargement…',
  wbDocChangeDeleted: 'Supprimé définitivement',
  wbDocChangeInTrash: 'Mis à la corbeille',
  wbDocChangeUntitled: 'Document sans titre',
  wbDocChangeViewList: 'Voir {count} documents',
  wbDocChangeMore: 'et {count} autres',
} satisfies Record<keyof typeof zh, string>
