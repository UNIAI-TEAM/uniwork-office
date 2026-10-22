import type { zh } from './zh'

export const fr = {
  algMenu: 'Journal d’accès',
  algTitle: 'Journal d’accès',
  algDescription:
    'Qui a consulté, téléchargé ou ouvert le document via un lien. Seuls les gestionnaires peuvent le lire.',
  algManageOnly: 'Vous avez besoin du droit de gestion pour lire le journal d’accès.',
  algLoading: 'Chargement du journal…',
  algError: 'Impossible de charger le journal d’accès.',
  algEmpty: 'Aucun accès enregistré pour le moment.',
  algFilterLabel: 'Action',
  algFilterAll: 'Toutes les actions',
  algActionView: 'Consultation',
  algActionDownload: 'Téléchargement',
  algActionExport: 'Export',
  algActionLinkView: 'Ouvert via un lien',
  algActionUnknown: 'Autre',
  algActorAnonymous: 'Anonyme',
  algActorSystem: 'Système',
  algActorUnknown: 'Inconnu',
  algVersion: 'version {no}',
} satisfies Record<keyof typeof zh, string>
