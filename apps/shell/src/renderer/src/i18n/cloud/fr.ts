import type { zh } from './zh'

export const fr = {
  cloudTitle: 'IA cloud UniWork',
  cloudStateReady: 'Disponible',
  cloudStateNotEntitled: 'Non inclus dans votre offre',
  cloudStateExhausted: 'Crédits IA épuisés',
  cloudStateUnavailable: 'Indisponible',
  cloudStateSignedOut: 'Non connecté',
  cloudStateInactive: 'Abonnement inactif',
  cloudCredits: 'Crédits IA',
  cloudCreditsLeft: '{remaining} / {limit} restants',
  cloudCreditsUnlimited: 'Illimité',
  cloudCreditsRenews: 'Renouvellement le {date}',
  cloudSignedOutBody:
    'Connectez-vous à UniWork pour utiliser la recherche web, la génération d’images et l’analyse de médias payées avec les crédits IA de votre organisation.',
  cloudNotEntitledBody:
    'L’offre de votre organisation n’inclut pas l’IA cloud UniWork. Vous pouvez toujours utiliser vos propres fournisseurs ci-dessous.',
  cloudExhaustedBody:
    'Votre organisation a utilisé tous ses crédits IA UniWork pour cette période. Les outils cloud sont suspendus jusqu’au renouvellement ; vos propres fournisseurs ci-dessous fonctionnent toujours.',
  cloudUnavailableBody:
    'L’IA cloud UniWork est indisponible pour le moment. Vos propres fournisseurs ci-dessous fonctionnent toujours.',
  cloudInactiveBody:
    'L’abonnement UniWork de votre organisation n’est pas actif : l’IA cloud est suspendue. Demandez à un administrateur de le renouveler ; vos propres fournisseurs ci-dessous continuent de fonctionner.',
  cloudToolsOffBody:
    'Les outils cloud UniWork sont désactivés. Activez « {switch} » dans {section} pour utiliser les crédits IA de votre organisation ; vos propres fournisseurs ci-dessous ne sont pas concernés.',
  cloudReadyBody:
    'Sans fournisseur personnel, la recherche, la génération d’images et l’analyse de médias utilisent les crédits IA UniWork de votre organisation.',
  cloudToolsToggle: 'Utiliser les outils cloud UniWork',
  cloudToolsToggleDesc:
    'Sans fournisseur personnel, la recherche web, la génération d’images et l’analyse de médias passent par le cloud UniWork (consomme des crédits IA).',
  cloudMediaLabel: 'Cloud UniWork',
  cloudMediaDesc: 'Utilise les crédits IA UniWork de votre organisation ; aucune clé requise.',
  cloudSearchAutoHint:
    'D’abord le cloud UniWork (consomme des crédits IA), puis la recherche gratuite.',
  aiTestErrInvalidKey: 'Clé API absente ou refusée',
  aiTestErrNetwork: 'Connexion impossible. Vérifiez votre réseau',
  aiTestErrLimit: 'Limite du fournisseur atteinte. Réessayez plus tard',
  aiTestErrUnavailable: 'Le service ne répond pas. Réessayez plus tard',
} satisfies Record<keyof typeof zh, string>
