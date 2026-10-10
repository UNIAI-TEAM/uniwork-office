import type { zh } from './zh'

export const fr = {
  aiWebSettingsTitle: 'Paramètres IA',
  aiWebSettingsIntro:
    "L'assistant utilise votre propre clé API de fournisseur. UniWork la conserve chiffrée ; la clé n'est jamais envoyée à cette page.",
  aiWebProvider: 'Fournisseur',
  aiWebModel: 'Modèle',
  aiWebKeySaved: 'Clé enregistrée {hint}',
  aiWebNoKey: 'Aucune clé enregistrée',
  aiWebApiKey: 'Clé API',
  aiWebApiKeyKeep: 'Nouvelle clé API (laisser vide pour garder la clé enregistrée)',
  aiWebBaseUrl: 'URL de base',
  aiWebSaveKey: 'Enregistrer la clé',
  aiWebRemoveKey: 'Supprimer la clé',
  aiWebDone: 'Terminé',
  aiWebLoading: 'Chargement…',
  aiWebLoadFailed: 'Impossible de charger les paramètres IA. Réessayez plus tard.',
  aiWebCloudTitle: 'Outils cloud UniWork AI',
  aiWebCloudOff: "Non inclus dans l'offre de votre organisation",
  aiWebCredits: 'Crédits restants : {remaining} sur {limit}',
  aiWebCreditsUnlimited: 'Crédits : illimités',
  aiWebCreditsRenew: 'Renouvellement le {date}',
  aiWebOpenSettings: 'Paramètres IA',
  aiWebClose: 'Fermer',
  aiWebStateCreditsTitle: 'Crédits IA épuisés',
  aiWebStateCreditsBody:
    'Votre organisation a utilisé tous ses crédits UniWork AI pour cette période. Contactez votre administrateur ou attendez le renouvellement.',
  aiWebStateEntitlementTitle: "L'IA n'est pas dans votre offre",
  aiWebStateEntitlementBody:
    "L'offre UniWork de votre organisation n'inclut pas cette fonction IA. Contactez votre administrateur.",
  aiWebStateKeyMissingTitle: 'Pas encore de clé IA',
  aiWebStateKeyMissingBody: 'Ajoutez une clé API dans les paramètres IA pour utiliser l’assistant.',
  aiWebStateKeyRejectedTitle: 'La clé IA a été refusée',
  aiWebStateKeyRejectedBody:
    'Le fournisseur a refusé la clé enregistrée. Remplacez-la dans les paramètres IA.',
  aiWebStateRateTitle: 'Trop de requêtes IA',
  aiWebStateRateBody: 'Attendez {seconds} s puis réessayez.',
  aiWebStateRateBodyNow: 'Patientez un instant puis réessayez.',
  aiWebStateUnreachableTitle: 'Fournisseur IA injoignable',
  aiWebStateUnreachableBody:
    "UniWork n'a pas pu joindre le fournisseur IA. Réessayez dans un instant.",
  aiWebStateCloudTitle: 'Outil cloud indisponible',
  aiWebStateCloudBody: "Cet outil UniWork AI n'est pas encore configuré sur le serveur.",
  aiWebStateSessionTitle: 'Session expirée',
  aiWebStateSessionBody: 'Rouvrez le document depuis UniWork pour continuer.',
  aiWebStateRefusedTitle: 'Requête refusée',
  aiWebStateRefusedBody: 'Le serveur a refusé la requête IA.',
  aiWebStateBaseUrlBody:
    "Cette URL de base n'est pas autorisée. Utilisez une adresse https:// publique.",
  aiWebStateProviderBody: "Ce fournisseur n'est pas pris en charge.",
  aiWebStateUnknownTitle: 'Échec de la requête IA',
  aiWebStateUnknownBody: 'Un problème est survenu. Réessayez.',
} satisfies Record<keyof typeof zh, string>
