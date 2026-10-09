import type { zh } from './zh'

export const fr = {
  cloudTitle: 'IA cloud UniWork',
  cloudStatus: 'Statut',
  cloudStateReady: 'Disponible',
  cloudStateNotEntitled: 'Non inclus dans votre offre',
  cloudStateExhausted: 'Crédits IA épuisés',
  cloudStateUnavailable: 'Indisponible',
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
  cloudReadyBody:
    'Sans fournisseur personnel, la recherche, la génération d’images et l’analyse de médias utilisent les crédits IA UniWork de votre organisation.',
  cloudToolsToggle: 'Utiliser les outils cloud UniWork',
  cloudToolsToggleDesc:
    'Sans fournisseur personnel, la recherche web, la génération d’images et l’analyse de médias passent par le cloud UniWork (consomme des crédits IA).',
  cloudMediaLabel: 'Cloud UniWork',
  cloudMediaDesc: 'Utilise les crédits IA UniWork de votre organisation ; aucune clé requise.',
  cloudSearchAutoHint:
    'D’abord le cloud UniWork (consomme des crédits IA), puis la recherche gratuite.',
} satisfies Record<keyof typeof zh, string>
