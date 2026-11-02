import type { zh } from './zh'

export const fr = {
  cloudTitle: 'IA cloud UniWork',
  cloudStateReady: 'Disponible',
  cloudStateNotEntitled: 'Non inclus dans votre offre',
  cloudStateExhausted: 'Crédits IA épuisés',
  cloudStateUnavailable: 'Indisponible',
  cloudStateInactive: 'Abonnement inactif',
  cloudCredits: 'Crédits IA',
  cloudCreditsLeft: '{remaining} / {limit} restants',
  cloudCreditsUnlimited: 'Illimité',
  cloudCreditsRenews: 'Renouvellement le {date}',
  cloudToolsToggle: 'Utiliser les outils cloud UniWork',
  cloudToolsToggleDesc:
    'Sans fournisseur personnel, la recherche web, la génération d’images et l’analyse de médias passent par le cloud UniWork (consomme des crédits IA).',
} satisfies Record<keyof typeof zh, string>
