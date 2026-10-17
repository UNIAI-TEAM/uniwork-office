import type { zh } from './zh'

export const fr = {
  webConflictTitle: 'Cette présentation a été modifiée ailleurs',
  webConflictBody:
    'Vos modifications ne sont pas encore sur UniWork et sont conservées dans ce navigateur jusqu’à votre déconnexion.',
  webConflictOverwrite: 'Écraser…',
  webConflictReload: 'Recharger la dernière version',
  webConflictNotSaved: 'la présentation a été modifiée ailleurs',
  webDiscardTitle: 'Abandonner les modifications non enregistrées ?',
  webDiscardBody:
    'Cette présentation contient des modifications non enregistrées. Ouvrir un autre fichier les fera perdre.',
  webDiscard: 'Abandonner et ouvrir',
  webCancel: 'Annuler',
  webOk: 'OK',
  webFatalTitle: "Impossible d'ouvrir la présentation",
  webFatalBody: 'Le fichier n’a pas pu être chargé depuis UniWork. Fermez cet onglet et réessayez.',
  webRefusedTooLarge:
    'Cette présentation est trop volumineuse ou trop complexe pour être ouverte sur le Web.',
  webRefusedTooComplex:
    'Cette présentation est trop complexe pour être ouverte sur le Web ({parts} parties, limite {limit}).',
  webRefusedOutOfMemory:
    'Cette présentation est trop volumineuse et la mémoire du navigateur a été épuisée lors de l’ouverture.',
  webNoHost: 'Cet éditeur fonctionne dans UniWork. Ouvrez la présentation depuis UniWork.',
  webLegacyPpt:
    'Ceci est un ancien fichier .ppt qui ne peut pas être ouvert dans le navigateur. Enregistrez-le d’abord au format .pptx dans PowerPoint.',
  webEncryptedPptx:
    'Cette présentation est protégée par un mot de passe et ne peut pas être ouverte dans le navigateur.',
  webCommentAuthor: 'Utilisateur',
  webExternalMedia: 'Les médias externes liés ne sont lus que dans l’application de bureau.',
  webReadOnly: 'Cette présentation est en lecture seule.',
  webSaveNetwork: 'Impossible de joindre UniWork. Vérifiez votre connexion et réessayez.',
  webSaveTimeout: "L'enregistrement a pris trop de temps. Vérifiez votre connexion et réessayez.",
  webFullscreenHint: 'Cliquez ou appuyez sur une touche pour passer en plein écran',
} satisfies Record<keyof typeof zh, string>
