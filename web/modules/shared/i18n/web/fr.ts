import type { zh } from './zh'

export const fr = {
  webCancel: 'Annuler',
  webConflictTitle: 'Ce document a été modifié ailleurs',
  webConflictBody:
    'Une version plus récente a été enregistrée pendant que vous modifiiez. Voulez-vous l’écraser avec votre version, ou recharger la dernière version et abandonner vos modifications ?',
  webConflictOverwrite: 'Écraser',
  webConflictReload: 'Recharger la dernière version',
  webConflictNotSaved: 'le document a été modifié ailleurs',
  webFatalTitle: 'Impossible d’ouvrir le document',
  webFatalBody:
    'La modification et l’enregistrement sont désactivés. Rechargez la page ou rouvrez le document depuis UniWork.',
  webNoHost: 'Cet éditeur fonctionne dans UniWork. Ouvrez le document depuis UniWork.',
  webViewOnly: 'Lecture seule',
  webViewOnlyNotSaved: 'Ce document est en lecture seule et ne peut pas être enregistré',
  webNotUtf8:
    'Ce fichier n’est pas du texte UTF-8. Il s’ouvre en lecture seule pour qu’un enregistrement ne modifie pas ses octets',
  webDraftTitle: 'Restaurer les modifications non enregistrées ?',
  webDraftBody:
    'Ce navigateur a conservé une copie de modifications non enregistrées de ce document. Les restaurer ou les ignorer ?',
  webDraftOlder:
    'Cette copie repose sur une version plus ancienne du document. L’enregistrer remplace la version plus récente.',
  webDraftSavedAt: 'Copie conservée à',
  webDraftKept: "Ce navigateur conserve la copie jusqu'à votre déconnexion.",
  webDraftRestore: 'Restaurer',
  webDraftDiscard: 'Ignorer',
  webSaveNetwork: 'Impossible de joindre UniWork. Vérifiez votre connexion et réessayez.',
  webSaveTimeout: "L'enregistrement a pris trop de temps. Vérifiez votre connexion et réessayez.",
  webClose: 'Fermer',
  webSaveUnauthorized:
    'Votre session UniWork a expiré. Reconnectez-vous, puis réessayez d’enregistrer.',
  webSaveForbidden: 'Vous n’avez pas l’autorisation d’enregistrer ce document.',
  webSaveNotFound: 'Ce document n’existe plus ou a été déplacé.',
  webSaveTooLarge: 'Le document est trop volumineux pour être enregistré.',
  webSaveRateLimited: 'Trop de requêtes. Patientez un instant, puis réessayez.',
  webSaveServer:
    'UniWork a rencontré un problème lors de l’enregistrement. Réessayez dans un instant.',
  webSaveFailedGeneric: 'Le document n’a pas pu être enregistré. Réessayez.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Vos modifications ne sont pas encore sur UniWork et sont conservées dans ce navigateur jusqu’à votre déconnexion.',
  uwConflictReloadWebBody:
    'Le navigateur ne conserve pas les brouillons de conflit. Téléchargez votre version pour la recopier plus tard, ou abandonnez vos modifications.',
  uwConflictDownloadThenReload: 'Télécharger ma version, puis recharger',
  uwConflictDiscardThenReload: 'Abandonner les modifications et recharger',
  uwConflictMineFileSuffix: '(ma version)',
  uwConflictDownloadCheck:
    'Votre navigateur a reçu votre fichier. Vérifiez qu’il a été enregistré, puis choisissez Recharger.',
  uwConflictSessionWeb:
    'Votre session a expiré, l’écrasement n’a donc pas eu lieu. Vos modifications restent dans ce navigateur ; reconnectez-vous et réessayez.',
  uwConflictTooLarge:
    'Votre version dépasse la taille maximale d’UniWork, l’écrasement est donc impossible.',
  uwConflictDownloadFailed:
    'Impossible de télécharger votre version, le document n’a donc pas été rechargé. Réessayez.',
  uwConflictOfflineWeb:
    'Vous êtes hors ligne. Sur le web, cette action nécessite une connexion ; vos modifications restent dans ce navigateur.',

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
  uwConflictSaveCopyOffline:
    'Vous êtes hors ligne. Créer une copie nécessite une connexion ; vos modifications sont conservées.',
  uwConflictReloadFailed:
    'Impossible de charger la dernière version. Votre document n’a pas changé ; réessayez.',
  uwConflictOverwriteFailed:
    'Impossible d’écraser pour l’instant. Votre document n’a pas changé ; réessayez.',
  uwConflictClose: 'Fermer',

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
    'En attente de la fin de l’enregistrement en cours ; vous pourrez recharger ensuite.',
  uwRemoteReload: 'Recharger la dernière version…',
  uwRemoteLater: 'Plus tard',
  uwRemoteClose: 'Fermer',
  uwRemoteReloadFailed:
    'Impossible de charger la version {n}. Vous consultez toujours la version précédente.',
  uwRemoteDeleted:
    'Ce document a été supprimé sur UniWork. Les enregistrements en attente sont arrêtés.',
  uwAuthorFallback: 'un membre',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'Vous n’avez plus accès à ce document. L’enregistrement est arrêté ; les modifications non enregistrées sont conservées dans ce navigateur jusqu’à votre déconnexion.',
  uwRemoteOrgBlockedWeb:
    'Enregistrement impossible : {reason}. Les modifications non enregistrées sont conservées dans ce navigateur jusqu’à votre déconnexion.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'document archivé',
  uwReasonSuspended: 'organisation suspendue',
  uwReasonDeactivated: 'votre compte est désactivé dans cette organisation',
} satisfies Record<keyof typeof zh, string>
