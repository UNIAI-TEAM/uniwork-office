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
  webReloaded: 'la dernière version a été rechargée et vos modifications ont été abandonnées',
  webViewOnlyNoSave: 'ce document est en lecture seule',
  webMergeTitle: 'Fusionner des PDF',
  webMergeBody: '{count} PDF sélectionné(s). Ajouter un autre PDF ou fusionner maintenant ?',
  webMergeAdd: 'Ajouter un autre PDF',
  webMergeNow: 'Fusionner maintenant',
} satisfies Record<keyof typeof zh, string>
