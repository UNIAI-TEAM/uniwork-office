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
  webSaveNetwork: 'Impossible de joindre UniWork. Vérifiez votre connexion et réessayez.',
  webSaveTimeout: "L'enregistrement a pris trop de temps. Vérifiez votre connexion et réessayez.",
  webAppOnlyHint: "Ouvrez dans l'application UniWork Office pour utiliser cette fonctionnalité",
  webAppOnlyOpen: "Ouvrir dans l'application",
  webAppOnlyOcr:
    "Ce PDF contient des pages numérisées. La reconnaissance de texte (OCR) n'est pas disponible ici.",
  webAppOnlyConvert:
    "La conversion d'un PDF en Word, Excel ou PowerPoint n'est pas disponible ici.",
} satisfies Record<keyof typeof zh, string>
