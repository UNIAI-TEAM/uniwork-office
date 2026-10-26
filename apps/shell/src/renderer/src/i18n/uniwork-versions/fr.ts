import type { zh } from './zh'

export const fr = {
  vhsMenuEntry: 'Historique des versions',
  vhsTitle: 'Historique des versions',
  vhsDescription:
    'Les versions conservées sur le serveur. Restaurer écrit une nouvelle version ; l’historique n’est jamais effacé.',
  vhsLoading: 'Chargement de l’historique…',
  vhsError: 'Impossible de charger l’historique des versions.',
  vhsRetry: 'Réessayer',
  vhsEmpty:
    'Aucune version pour l’instant. Créez la première version à partir de la copie de travail.',
  vhsLoadMore: 'Charger plus',
  vhsRowVersion: 'Version {no}',
  vhsAuthorSystem: 'Système',
  vhsAuthorFormer: 'Ancien membre',
  vhsAuthorAgent: 'Agent',
  vhsCurrentBadge: 'Actuelle',
  vhsView: 'Voir le contenu',
  vhsPreviewTitle: 'Contenu de la version {no}',
  vhsPreviewError: 'Impossible de charger le contenu de cette version.',
  vhsPreviewEmpty: 'Cette version n’a pas de contenu.',
  vhsOpenUnsupported:
    'Cette version ne peut pas être ouverte dans l’application. Téléchargez-la à la place.',
  vhsDownload: 'Télécharger cette version',
  vhsDownloadVersion: 'Télécharger la version {no}',
  vhsDownloadFailed: 'Impossible de télécharger le fichier',
  vhsNameLabel: 'Nom de la version',
  vhsNamePlaceholder: 'p. ex. Avant les modifications de la relecture',
  vhsNameHint: 'La version enregistre la copie de travail ; le nom est facultatif.',
  vhsNameSubmit: 'Créer une version',
  vhsNameSubmitting: 'Création…',
  vhsNameDone: 'Version {no} créée',
  vhsNameFailed: 'Impossible de créer la version. Ce que vous avez saisi est conservé.',
  vhsNameUnchanged:
    'Rien n’a changé depuis la dernière version, aucune nouvelle version n’a donc été créée.',
  vhsRestore: 'Restaurer la version {no}',
  vhsRestoreConfirmTitle: 'Restaurer la version {no} ?',
  vhsRestoreConfirmDescription:
    'La copie de travail reprend le contenu de cette version et une nouvelle version de restauration est ajoutée. L’historique reste intact.',
  vhsRestoreConfirmSubmit: 'Restaurer',
  vhsRestoreSubmitting: 'Restauration…',
  vhsRestoreFailed: 'Impossible de restaurer. La copie de travail est inchangée.',
  vhsRestoreConflict: 'La copie de travail vient de changer. Rouvrez l’historique et réessayez.',
  vhsManageOnly: 'Il faut un accès en modification pour restaurer une version.',
  vhsShelvedBlocked: 'Ce document est archivé et en lecture seule.',
  vhsLockedByOther:
    'Quelqu’un d’autre modifie ce document. Attendez qu’il ait terminé ou reprenez la modification, puis réessayez.',
  vhsLockedByMe:
    'Vous modifiez ce document dans une autre fenêtre. Enregistrez-le ou fermez-le là-bas, puis réessayez.',
  vhsReasonUpload: 'importée',
  vhsReasonManual: 'version manuelle',
  vhsReasonAuto: 'automatique',
  vhsReasonRestore: 'restauration',
  vhsReasonAgent: 'agent',
  vhsReasonUnknown: 'autre',
  vhsClose: 'Fermer',
  vhsCancel: 'Annuler',
} satisfies Record<keyof typeof zh, string>
