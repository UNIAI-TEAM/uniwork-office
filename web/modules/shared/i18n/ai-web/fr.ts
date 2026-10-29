import type { zh } from './zh'

export const fr = {
  aiWebClose: 'Fermer',
  aiWebStateCreditsTitle: 'Crédits IA épuisés',
  aiWebStateCreditsBody:
    'Votre organisation a utilisé tous ses crédits UniWork AI pour cette période. Contactez votre administrateur ou attendez le renouvellement.',
  aiWebStateEntitlementTitle: "L'IA n'est pas dans votre offre",
  aiWebStateEntitlementBody:
    "L'offre UniWork de votre organisation n'inclut pas cette fonction IA. Contactez votre administrateur.",
  aiWebStateRateTitle: 'Trop de requêtes IA',
  aiWebStateRateBody: 'Attendez {seconds} s puis réessayez.',
  aiWebStateRateBodyNow: 'Patientez un instant puis réessayez.',
  aiWebStateUnreachableTitle: 'Fournisseur IA injoignable',
  aiWebStateUnreachableBody:
    "UniWork n'a pas pu joindre le fournisseur IA. Réessayez dans un instant.",
  aiWebStateCloudTitle: 'Outil cloud indisponible',
  aiWebStateCloudBody: "Cet outil UniWork AI n'est pas encore configuré sur le serveur.",
  aiWebStateOutageTitle: 'UniWork temporairement indisponible',
  aiWebStateOutageBody: 'UniWork est injoignable pour le moment. Réessayez dans un instant.',
  aiWebStateSessionTitle: 'Session expirée',
  aiWebStateSessionBody: 'Rouvrez le document depuis UniWork pour continuer.',
  aiWebStateRefusedTitle: 'Requête refusée',
  aiWebStateRefusedBody: 'Le serveur a refusé la requête IA.',
  aiWebStateUnknownTitle: 'Échec de la requête IA',
  aiWebStateUnknownBody: 'Un problème est survenu. Réessayez.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Ce classeur est trop volumineux pour l’IA sur le web. Ouvrez-le dans l’application UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Continuez avec la partie suivante.',
} satisfies Record<keyof typeof zh, string>
