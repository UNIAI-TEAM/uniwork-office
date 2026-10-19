import type { zh } from './zh'

export const fr = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Enregistrement en file d’attente — pas encore sur UniWork',
  uwChipQueuedNewer: 'Enregistrement en file d’attente · modifications plus récentes',
  uwChipPausedAdmin: 'Enregistrement en file d’attente · envoi suspendu',
  uwChipReconciling: 'Vérification du dernier enregistrement…',
  uwChipReconcileStuck: 'Assistance requise pour confirmer l’enregistrement',
  uwErrReconcileStuck: 'Assistance requise pour confirmer l’enregistrement.',
  uwChipRemoteNewer: 'Version plus récente sur UniWork',
  uwTipQueued:
    'Votre enregistrement de {time} est conservé en sécurité sur cet ordinateur et sera envoyé dès que possible.',
  uwTipQueuedNewer:
    'L’enregistrement de {time} attend d’être envoyé. Les modifications ultérieures n’en font pas partie.',
  uwTipPausedAdmin:
    'Votre administrateur a suspendu l’envoi. L’enregistrement est conservé sur cet ordinateur.',
  uwTipPausedUser:
    'Vous avez suspendu l’envoi. L’enregistrement de {time} est conservé sur cet ordinateur ; choisissez Reprendre l’envoi dans le centre de synchronisation.',
  uwTipReconciling:
    'On ne sait pas encore si le dernier enregistrement est arrivé sur UniWork. L’application vérifie et ne créera pas de doublon.',
  uwTipRemoteNewer:
    'Vous avez des modifications non enregistrées, le document n’a donc pas été rechargé.',
  uwTipFailed:
    'Cet enregistrement ne sera pas relancé automatiquement : {reason}. Vos modifications restent sur cet ordinateur.',
  uwTipWaitAi: 'En attente de la fin de l’étape en cours de l’IA, puis enregistrement.',
  uwTipWaitAiLong:
    'L’IA n’a pas terminé son étape en cours. Arrêtez l’exécution de l’IA pour enregistrer maintenant.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Voir la file d’attente',
  uwActSaveAgain: 'Enregistrer à nouveau',
  uwActStopAi: 'Arrêter l’IA',
  uwActBack: 'Retour',
  uwQueuePopWaiting: 'En attente d’enregistrement : de {time} (basé sur la version {base})',
  uwQueuePopNewer: 'Modifications plus récentes depuis — non envoyées',
  uwQueueBlockedSave:
    'Votre dernier enregistrement est toujours en attente. Vous pourrez enregistrer à nouveau une fois qu’il sera terminé.',
  uwQueueFull:
    'Le stockage de synchronisation de cet ordinateur est plein, l’enregistrement n’a donc pas été mis en file d’attente. Vos modifications sont toujours dans la fenêtre ouverte ; libérez de l’espace dans le centre de synchronisation.',
  uwQueueOpenCenter: 'Ouvrir le centre de synchronisation',
  uwQueueCancel: 'Annuler l’enregistrement…',
  uwQueueCancelConfirm:
    'Annuler l’enregistrement en file d’attente ? Vos modifications restent sur cet ordinateur ; le document sur UniWork ne change pas.',
  uwQueueCancelGo: 'Annuler l’enregistrement',
  uwQueueCancelled:
    'Enregistrement en file d’attente annulé. Vos modifications restent sur cet ordinateur.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'reconnectez-vous',
  uwReasonSignedOut: 'déconnecté',
  uwReasonForeign: 'appartient à un autre compte',
  uwReasonArchived: 'document archivé',
  uwReasonSuspended: 'organisation suspendue',
  uwReasonDeactivated: 'votre compte est désactivé dans cette organisation',
  uwReasonLease: 'accès hors ligne expiré',
  uwReasonKeystore: 'le trousseau de cet ordinateur est verrouillé',
  uwReasonClock: 'l’horloge a été reculée',
  uwReasonStoreFull: 'le stockage de synchronisation de cet ordinateur est plein',
  uwReasonStoreNewer: 'une version plus récente de l’application est nécessaire',

  // S2 queue-row badges
  uwBadgeQueued: 'En attente',
  uwBadgeWaitNetwork: 'En attente du réseau',
  uwBadgePausedUser: 'Suspendu par vous',
  uwBadgePausedAdmin: 'Suspendu par l’administrateur',
  uwBadgeSending: 'Envoi',
  uwBadgeReconciling: 'Vérification',
  uwBadgeReconcileStuck: 'Assistance requise',
  uwBadgeConflict: 'Conflit',
  uwBadgeBlocked: 'Bloqué',
  uwBadgeLocked: 'Verrouillé',
  uwBadgeRevoked: 'Aucun accès',
  uwBadgeDeleted: 'Supprimé',
  uwBadgeReconnect: 'Reconnexion requise',
  uwBadgeKeystore: 'Trousseau verrouillé',
  uwBadgeFailed: 'Envoi impossible',
  uwBadgeSaved: 'Enregistré',
  uwBadgeKeptDraft: 'Brouillon conservé',
  uwBadgeMoved: 'Déplacé',
  uwBadgeArchived: 'Archivé',

  // S2 queue-row details
  uwRowQueued: 'Enregistré {time} · basé sur la version {base} · {size}',
  uwRowWaitNetwork: 'Sera envoyé une fois en ligne',
  uwRowPausedUser: 'Sera envoyé quand vous choisirez Reprendre l’envoi',
  uwRowPausedAdmin: 'Sera envoyé quand votre administrateur réactivera l’envoi',
  uwRowUploading: 'Envoi {done} / {total}',
  uwRowCommitting: 'Création de la version',
  uwRowReconciling:
    'Le résultat de l’envoi de {time} n’est pas encore clair. Vérification auprès d’UniWork.',
  uwRowReconcileStuck:
    'Tentatives de vérification : {count}, toujours aucun résultat. L’application ne renverra pas ; envoyez le code d’assistance à votre administrateur.',
  uwStuckDiscardConfirm:
    'Abandonner cet enregistrement ? S’il est déjà arrivé sur UniWork, cette version reste ; votre copie est conservée comme brouillon dans le centre de synchronisation.',
  uwRowConflict: 'La version {n} a été enregistrée par {author} à {time}',
  uwRowFailed: 'Envoi impossible : {reason}',
  uwRowBlocked: 'Enregistrement impossible : {reason}',
  uwRowCommitted: 'Version {n} · {time}',
  uwRowKeptDraft: 'Conservé lors du rechargement à {time}',
  uwRowMoved: 'Le document a été déplacé vers {workspace}',
  uwRowArchived: 'Le document a été archivé sur UniWork',

  // S2 row actions
  uwActDiscard: 'Abandonner',
  uwActDiscardSave: 'Abandonner l’enregistrement…',
  uwActSendNow: 'Envoyer maintenant',
  uwActRecheck: 'Vérifier à nouveau',
  uwActGuide: 'Guide',
  uwActOpenToResolve: 'Ouvrir pour résoudre',
  uwActCopySupport: 'Copier le code d’assistance',
  uwActDownloadMine: 'Télécharger ma version',
  uwActOpenDraft: 'Ouvrir le brouillon',
  uwActDiscardDraft: 'Abandonner le brouillon…',
  uwActSignInAgain: 'Se reconnecter',
  uwActSignIn: 'Se connecter',
  uwActSwitchAccount: 'Changer de compte',
  uwActReconnect: 'Se reconnecter',
  uwActDetails: 'Détails',
  uwActOpen: 'Ouvrir',
  uwDiscardDraftConfirm:
    'Abandonner ce brouillon ? Ses modifications seront supprimées de cet ordinateur et ne pourront pas être récupérées.',

  // Sign-out prompt
  uwSignOutTitle: 'Se déconnecter d’UniWork ?',
  uwSignOutBody:
    'Documents avec des modifications non enregistrées ou des enregistrements en attente : {count}. Ils restent verrouillés sur cet ordinateur et seul votre compte pourra les rouvrir.',
  uwSignOutKeystore:
    'Le trousseau de l’ordinateur est verrouillé, les modifications non enregistrées n’existent donc que dans les fenêtres ouvertes. Vous déconnecter maintenant les supprime ; ce qui est déjà conservé chiffré reste. Pour les garder, déverrouillez d’abord l’ordinateur.',
  uwSignOutGo: 'Se déconnecter',
  uwSignOutWaiting: 'Finalisation de l’enregistrement en cours avant la déconnexion…',
  uwSignOutCaptureFailed:
    'Certaines modifications non enregistrées n’ont pas pu être capturées à temps ; la version enregistrée ou enregistrée automatiquement la plus récente est conservée pour votre compte.',
  uwSignOutTimedOut: 'La déconnexion a pris trop de temps à confirmer ; le compte est peut-être toujours connecté.',
  uwSwitchLostTitle: 'Des modifications non enregistrées du compte précédent ont été perdues',
  uwSwitchLostBody:
    'Un autre compte s’est connecté sur cet ordinateur, le compte précédent a donc été verrouillé. Documents dont les modifications non enregistrées n’ont pas pu être conservées : {count}. Tout le reste reste verrouillé sur cet ordinateur pour ce compte.',
  uwSwitchLostOk: 'OK',

  // S2 sync center
  uwSyncTitle: 'Centre de synchronisation',
  uwSyncOpenFromSettings: 'Centre de synchronisation',
  uwSyncOnline: 'Connecté à UniWork · synchronisé {time}',
  uwSyncOffline: 'Hors ligne · dernière synchronisation {time}',
  uwSyncOnlineNoTime: 'Connecté à UniWork',
  uwSyncOfflineNoTime: 'Hors ligne',
  uwSyncPaused: 'Envoi suspendu — les nouveaux enregistrements attendront',
  uwSyncAdminPaused:
    'Votre administrateur a suspendu l’envoi. Les enregistrements sont conservés sur cet ordinateur.',
  uwSyncFeedOff:
    'Les avis de nouvelle version sont suspendus. UniWork vérifie toujours les conflits lorsque vous enregistrez.',
  uwSyncResynced: 'Entièrement resynchronisé à {time}',
  uwSyncResyncFailed:
    'Impossible de resynchroniser après plusieurs tentatives. Les avis de nouvelle version sont suspendus ; UniWork vérifie toujours les conflits lorsque vous enregistrez.',
  uwSyncSignedOut:
    'Vous êtes déconnecté. Éléments conservés verrouillés sur cet ordinateur : {count}.',
  uwSyncSignedOutEmpty: 'Vous êtes déconnecté.',
  uwSyncSessionExpired: 'Votre session a expiré. Reconnectez-vous pour continuer l’envoi.',
  uwSyncOtherOrg: 'Enregistrements en attente dans une autre organisation : {count}',
  uwSyncStoreBudget: 'Stockage de synchronisation sur cet ordinateur : {used} sur {cap}',
  uwSyncStoreError:
    'Impossible de lire la file d’attente de cet ordinateur. Rien n’a été supprimé.',
  uwSyncNow: 'Synchroniser maintenant',
  uwSyncPause: 'Suspendre l’envoi',
  uwSyncResume: 'Reprendre l’envoi',
  uwSyncNowOffline: 'La synchronisation nécessite une connexion.',
  uwSyncTabAttention: 'À traiter',
  uwSyncTabQueue: 'En attente d’enregistrement',
  uwSyncTabOffline: 'Disponible hors ligne',
  uwSyncTabRecent: 'Enregistrés récemment',
  uwSyncTabCount: '{label} : {count}',
  uwSyncColDoc: 'Document',
  uwSyncColState: 'État',
  uwSyncColDetail: 'Détails',
  uwSyncColActions: 'Actions',
  uwSyncMoreActions: 'Autres actions pour {doc}',
  uwSyncEmptyQueue: 'Aucun enregistrement en attente.',
  uwSyncEmptyAttention: 'Rien à traiter.',
  uwSyncEmptyRecent: 'Aucun enregistrement récent.',
  uwSyncActionFailed: 'L’action n’a pas abouti. Rien n’a été supprimé ; réessayez.',
  uwSyncRowAnnounce: '{doc} : {state}',

  // S3 offline library
  uwOfflinePin: 'Rendre disponible hors ligne',
  uwOfflineUnpin: 'Supprimer la copie hors ligne',
  uwOfflineUnpinShort: 'Désépingler',
  uwOfflineAdd: 'Ajouter des documents…',
  uwOfflineUsage: '{used} utilisés sur {cap} sur cet ordinateur',
  uwOfflineEmpty: 'Aucun document n’est encore disponible hors ligne.',
  uwOfflineCapReached:
    'La bibliothèque hors ligne de cet ordinateur a atteint sa limite : stockage {cap} ; nombre maximal de documents : {maxDocs}. Supprimez une copie hors ligne pour en ajouter une autre.',
  uwOfflineReady: 'Disponible hors ligne',
  uwOfflineBadgeWaiting: 'En attente du réseau',
  uwOfflineBadgeDownloading: 'Téléchargement',
  uwOfflineBadgeVerifying: 'Vérification',
  uwOfflineBadgeUpdate: 'Mise à jour disponible',
  uwOfflineBadgeInterrupted: 'Pas prêt',
  uwOfflineBadgeDiskFull: 'Espace insuffisant',
  uwOfflineBadgeCorrupt: 'Téléchargement endommagé',
  uwOfflineBadgeLeaseSoon: 'Accès hors ligne bientôt expiré',
  uwOfflineBadgeViewOnly: 'Disponible hors ligne · lecture seule',
  uwOfflineRowWaiting: 'Sera téléchargé une fois en ligne',
  uwOfflineRowProgress: '{done} sur {total}',
  uwOfflineRowProgressAria: '{done} sur {total}',
  uwOfflineRowVerifying: 'Vérification de l’intégrité',
  uwOfflineRowReady: 'Version {n} · {size} · accès hors ligne jusqu’au {datetime}',
  uwOfflineRowUpdate:
    'La version {n} sera téléchargée une fois en ligne ; la version {old} fonctionne toujours',
  uwOfflineRowUpdateKept:
    'Impossible de passer à la version {n} : {reason}. La version {old} fonctionne toujours.',
  uwOfflineRowInterrupted:
    'Le téléchargement a été interrompu. L’ancienne copie (le cas échéant) fonctionne toujours.',
  uwOfflineRowDiskFull: '{size} supplémentaires nécessaires. L’ancienne copie est conservée.',
  uwOfflineRowCorrupt: 'La copie endommagée a été supprimée. Téléchargez-la à nouveau.',
  uwOfflineRowLeaseSoon: 'Connectez-vous avant le {datetime} pour renouveler',
  uwOfflineRowRevoked:
    'Vous n’avez plus accès à ce document. La copie téléchargée a été supprimée ; les brouillons restent verrouillés.',
  uwOfflineRowDeleted:
    'Le document a été supprimé sur UniWork. La copie téléchargée a été supprimée ; les brouillons restent verrouillés.',
  uwOfflineRowArchived:
    'Le document a été archivé ; la copie locale s’ouvre jusqu’à la fin de l’accès hors ligne.',
  uwOfflineRowMoved: 'Déplacé vers {workspace} ; la copie locale fonctionne toujours.',
  uwOfflineRowViewOnly: 'Version {n} · lecture seule · accès hors ligne jusqu’au {datetime}',
  uwOfflineReadyAnnounce: 'Disponible hors ligne : {doc}',
  uwOfflineUnpinConfirm:
    'La copie téléchargée sera supprimée de cet ordinateur. Les brouillons et enregistrements en attente sont conservés.',
  uwOfflineCancelDownload: 'Annuler le téléchargement',
  uwOfflineDownloadNow: 'Télécharger maintenant',
  uwOfflineOpenFolder: 'Ouvrir le dossier de stockage',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Reconnexion requise',
  uwLockKeystoreTitle: 'Le trousseau de cet ordinateur est verrouillé',
  uwLockClockTitle: 'Vérification de l’heure requise',
  uwLockRevokedTitle: 'Aucun accès',
  uwLockDeletedTitle: 'Document supprimé',
  uwLockForeignTitle: 'Appartient à un autre compte',
  uwLockOrgTitle: 'Ouverture impossible dans cette organisation',
  uwLockExpired:
    'L’accès hors ligne a expiré. Le contenu reste chiffré ; connectez-vous pour l’ouvrir à nouveau.',
  uwLockLibraryOff:
    'Votre administrateur a désactivé les documents hors ligne, l’accès hors ligne ne peut donc pas être renouvelé. Les brouillons restent verrouillés dans le centre de synchronisation.',
  uwLockKeystore:
    'Le trousseau de l’ordinateur est verrouillé, le contenu chiffré ne peut donc pas être ouvert. Déverrouillez-le et réessayez ; rien n’a été supprimé.',
  uwLockClock:
    'L’horloge de l’ordinateur a été reculée, l’accès hors ligne est donc verrouillé. Connectez-vous pour qu’UniWork vérifie l’heure.',
  uwLockForeign:
    'Ce document appartient à un autre compte sur cet ordinateur. Passez à ce compte pour l’ouvrir.',
  uwLockSuspended:
    'L’organisation est suspendue. Le contenu reste chiffré ; contactez votre administrateur.',
  uwLockDeactivated:
    'Votre compte est désactivé dans cette organisation. Le contenu reste chiffré ; contactez votre administrateur.',
  uwLockSignedOutTitle: 'Vous êtes déconnecté',
  uwLockSignedOut:
    'Le contenu reste verrouillé sur cet ordinateur. Connectez-vous avec le même compte pour l’ouvrir à nouveau.',
  uwLockRegion: 'État du document',
  uwLockWhileOpen:
    'Le document a été verrouillé pendant qu’il était ouvert. Les modifications non enregistrées sont conservées chiffrées ; vous ne pouvez ni enregistrer ni copier tant qu’il n’est pas déverrouillé.',
  uwLockWhileOpenRam:
    'Le document a été verrouillé pendant qu’il était ouvert et cet ordinateur ne peut pas encore conserver vos modifications en sécurité. Elles n’existent que dans cette fenêtre (lecture seule) ; la fermer les fait perdre.',
  uwLockOtherWindow:
    'Ce document est ouvert en modification dans une autre fenêtre. Cette fenêtre est en lecture seule.',
  uwLockOtherWindowGone:
    'La fenêtre qui modifiait ce document ne répond plus. Vous pouvez le modifier dans cette fenêtre.',
  uwLockGoToWindow: 'Aller à cette fenêtre',
  uwLockTakeEdit: 'Modifier dans cette fenêtre',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Votre version',
  uwConflictColServer: 'Version sur UniWork',
  uwConflictRowVersion: 'Version',
  uwConflictRowTime: 'Heure',
  uwConflictRowBy: 'Enregistré par',
  uwConflictMineUnsaved: 'Vous (non enregistré)',
  uwConflictBasedOn: 'basé sur la version {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Voir les différences',
  uwConflictNoEdit: 'Vous n’avez plus le droit de modifier ce document.',
  uwConflictOverwriteTitle: 'Écraser avec votre version ?',
  uwConflictOverwriteConfirm:
    'UniWork créera la version {next} à partir de votre copie. La version {server} de {author} reste dans l’historique.',
  uwConflictOverwriteGo: 'Écraser',
  uwConflictBack: 'Retour',
  uwConflictHeadMoved:
    'Entre-temps, UniWork a reçu la version {n}. Le tableau est à jour ; choisissez à nouveau.',
  uwConflictReloadTitle: 'Recharger la dernière version',
  uwConflictReloadGo: 'Recharger',
  uwConflictSaveCopy: 'Enregistrer une copie…',
  uwConflictSaveCopyTitle: 'Enregistrer une copie ?',
  uwConflictSaveCopyConfirm:
    'UniWork créera un nouveau document à partir de votre version, avec le même propriétaire et les mêmes accès que ce document. Le document actuel et la version {server} de {author} restent inchangés.',
  uwConflictSaveCopyGo: 'Créer la copie',
  uwConflictSaveCopyDone:
    'Votre version a été enregistrée comme nouveau document : {title}. Ce document n’a pas changé ; vous pouvez toujours recharger ou écraser.',
  uwConflictSaveCopyFailed:
    'Impossible de créer la copie. Vos modifications sont toujours en sécurité ; réessayez.',
  uwConflictSaveCopyNoSeat:
    'Impossible de créer la copie, car vous n’êtes pas membre de l’espace de travail qui contient ce document. Vos modifications sont toujours en sécurité ; vous pouvez télécharger votre version.',
  uwConflictSaveCopyFolderRefused:
    'Vous ne pouvez pas créer de documents dans ce dossier. Téléchargez plutôt votre version.',
  uwConflictDownloadDone:
    'Votre version a été enregistrée sur cet ordinateur : {file}. Ce document n’a pas changé ; vous pouvez toujours recharger ou écraser.',
  uwConflictDownloadFailedDesktop:
    'Impossible d’enregistrer le fichier. Vos modifications sont toujours en sécurité ; réessayez.',
  uwConflictSaveCopyOffline:
    'Vous êtes hors ligne. Créer une copie nécessite une connexion ; vos modifications sont conservées.',
  uwConflictReloadFailed:
    'Impossible de charger la dernière version. Votre document n’a pas changé ; réessayez.',
  uwConflictOverwriteFailed:
    'Impossible d’écraser pour l’instant. Votre document n’a pas changé ; réessayez.',
  uwConflictClose: 'Fermer',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Ce document a été modifié ailleurs',
  uwConflictBody:
    'Vos modifications ne sont pas encore sur UniWork et sont en sécurité sur cet ordinateur.',
  uwConflictReload: 'Recharger la dernière version',
  uwConflictOverwrite: 'Écraser…',
  uwConflictCancel: 'Annuler',
  uwConflictKeepUnavailable:
    'Cet ordinateur ne peut pas conserver de brouillon pour le moment (stockage de synchronisation plein ou trousseau verrouillé).',
  uwConflictOfflineDesktop:
    'Vous êtes hors ligne et la dernière version n’est pas sur cet ordinateur, le rechargement est donc impossible pour l’instant.',
  uwConflictReloadDesktopBody:
    'Choisissez ce qu’il advient de vos modifications avant le chargement de la version {n}.',
  uwConflictKeepDraft: 'Conserver ma version comme brouillon',
  uwConflictDiscard: 'Abandonner mes modifications',
  uwConflictKeepDraftHint:
    'Le brouillon reste dans le centre de synchronisation pour être consulté ou copié ; il n’est jamais appliqué automatiquement à la nouvelle version.',
  uwConflictDraftCapReached:
    'Ce document a atteint le nombre maximal de brouillons conservés : {cap}. Abandonnez un ancien brouillon dans le centre de synchronisation pour en conserver un autre.',

  // S6 new-version bar
  uwRemoteRegion: 'Nouvelle version',
  uwRemoteUpdated: 'Mis à jour vers la version {n}, enregistrée par {author} à {time}.',
  uwRemoteUpdatedNoRev: 'Mis à jour vers la dernière version sur UniWork.',
  uwRemoteNewerDirty:
    'Une version plus récente est sur UniWork (version {n}). Vous avez des modifications non enregistrées, le document n’a donc pas été rechargé.',
  uwRemoteNewerAi:
    'Une version plus récente est sur UniWork (version {n}). UniWork AI est en cours d’exécution, le document n’a donc pas été rechargé ; les résultats de l’IA ne s’appliquent qu’à la copie ouverte.',
  uwRemoteNowClean:
    'Vous avez annulé toutes les modifications. La version {n} sur UniWork est plus récente que la copie ouverte.',
  uwRemoteStopAiConfirm:
    'Arrêter l’exécution en cours d’UniWork AI pour recharger ? Les modifications déjà faites par l’IA appartiennent à la copie ouverte.',
  uwRemoteWaitCommit:
    'En attente de la fin de l’enregistrement en cours ; vous pourrez continuer ensuite.',
  uwRemoteReload: 'Recharger la dernière version…',
  uwRemoteLater: 'Plus tard',
  uwRemoteClose: 'Fermer',
  uwRemoteReloadFailed:
    'Impossible de charger la version {n}. Vous consultez toujours la version précédente.',
  uwRemoteDeleted:
    'Ce document a été supprimé sur UniWork. Les enregistrements en attente sont arrêtés.',
  uwAuthorFallback: 'un membre',

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'L’enregistrement précédent nécessite une assistance, vous ne pouvez donc pas encore recharger ni écraser. Ouvrez le centre de synchronisation pour le résoudre.',
  uwRemoteRevoked:
    'Vous n’avez plus accès à ce document. L’enregistrement est arrêté ; les modifications non enregistrées sont conservées verrouillées sur cet ordinateur.',
} satisfies Record<keyof typeof zh, string>
