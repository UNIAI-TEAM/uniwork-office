import type { zh } from './zh'

export const fr = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Crédits restants : {remaining} sur {limit}',
  aiUniworkFooterSignIn: 'Connectez-vous à UniWork pour utiliser UniWork AI',
  aiUniworkSignedOut:
    'Vous êtes déconnecté d’UniWork. Choisissez un autre fournisseur ou reconnectez-vous.',
  aiUniworkOff: 'UniWork AI est désactivé pour ce document. Choisissez un autre fournisseur.',
  aiUniworkViewOnly:
    'Lecture seule : l’IA peut répondre mais ne peut ni modifier ni enregistrer le document.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI lit ce qui est ouvert dans ce document, y compris les modifications non enregistrées, et l’envoie à UniWork et au fournisseur du modèle pour répondre. Chaque exécution utilise les crédits IA de {org}. L’IA n’enregistre jamais à votre place : vérifiez, puis appuyez sur Enregistrer.',
  aiUniworkDisclosureLabel: 'Ce que reçoit UniWork AI',
  aiUniworkDisclosureShort:
    'Envoie le contenu ouvert (y compris non enregistré) à UniWork · crédits de {org}',
  aiUniworkLocalFile:
    'Ce fichier est sur votre ordinateur, pas dans UniWork. Avec UniWork AI, le contenu du fichier ouvert est envoyé à UniWork et utilise les crédits IA de {org}. Le fichier n’est pas importé comme document UniWork.',
  aiUniworkAck: 'J’ai compris',
  aiUniworkLearnMore: 'En savoir plus',
  aiUniworkDetails: 'Détails',
  aiUniworkSendNeedsAck: 'Lisez et confirmez l’avis avant d’envoyer.',

  // S9 result chips and run controls
  aiResultAnswer: 'Réponse',
  aiResultClarify: 'Précision nécessaire',
  aiResultEdited: 'Modifié dans le document',
  aiResultUnsupported: 'Non pris en charge',
  aiResultError: 'Erreur',
  aiResultEditedHint:
    'Non enregistré — annulez avec Ctrl/⌘+Z, ou appuyez sur Enregistrer si tout est correct.',
  aiResultViewChanges: 'Voir les modifications',
  aiRunStop: 'Arrêter',
  aiRunSend: 'Envoyer',
  aiRunRunning: 'En cours… Appuyez sur Arrêter ou Échap pour arrêter.',
  aiRunStopped:
    'Arrêté. Les modifications déjà appliquées restent dans le document et peuvent être annulées.',
  aiRunAskAgain: 'Redemander',
  aiRunChooseOther: 'Choisir un autre fournisseur',
  aiRunOpenInApp: 'Ouvrir dans l’application',
  aiConversationRestarted:
    'La conversation précédente a expiré : UniWork AI en a commencé une nouvelle et ne se souvient plus des échanges précédents. Renvoyez votre question pour continuer.',
  aiConversationBoundary:
    'Nouvelle conversation avec {provider} : les échanges ci-dessus ne sont pas envoyés.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Cette exécution a atteint la limite d’étapes d’UniWork AI. Les résultats obtenus sont conservés ; divisez la demande et redemandez.',
  aiErrCredits:
    'Votre organisation n’a plus de crédits IA pour cette période. Cette exécution s’est arrêtée.',
  aiErrEntitlement: 'L’offre de votre organisation n’inclut plus UniWork AI.',
  aiErrRateLimited: 'Vous envoyez trop vite. Réessayez dans {seconds} s.',
  aiErrRateLimitedNoWait: 'Vous envoyez trop vite. Réessayez dans quelques minutes.',
  aiErrUnavailable:
    'UniWork AI ne répond pas pour le moment. Votre document et Enregistrer fonctionnent toujours.',
  aiErrDisconnected:
    'La connexion a été interrompue, cette exécution s’est donc arrêtée. Les modifications déjà appliquées restent dans le document et peuvent être annulées.',
  aiErrOffline:
    'Vous êtes hors ligne. UniWork AI ne fonctionne pas hors ligne et les demandes ne sont pas mises en file d’attente.',
  aiErrSession:
    'Votre session UniWork a expiré, cette exécution s’est donc arrêtée. Reconnectez-vous pour continuer.',
  aiErrRevoked: 'Vous n’avez plus accès à ce document, l’exécution de l’IA s’est donc arrêtée.',
  aiErrDowngraded:
    'Votre accès vient de passer en lecture seule : l’IA a cessé de modifier. Les réponses continuent.',
  aiErrCapabilityOff:
    'UniWork AI vient d’être désactivé pour ce document : l’exécution s’est arrêtée après l’étape en cours.',
  aiErrUnsupported: 'UniWork AI ne peut pas encore faire cela dans {module}.',
  aiErrViewOnlyEdit:
    'Vous n’avez qu’un accès en lecture à ce document : l’IA ne peut pas le modifier.',
} satisfies Record<keyof typeof zh, string>
