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
} satisfies Record<keyof typeof zh, string>
