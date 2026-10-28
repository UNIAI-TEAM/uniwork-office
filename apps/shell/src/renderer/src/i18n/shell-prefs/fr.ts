import type { zh } from './zh'

export const fr = {
  setRestoreSession: 'Rouvrir les documents de la dernière fois',
  setRestoreSessionDesc:
    'Les documents ouverts à la fermeture de UniWork Office se rouvrent automatiquement au prochain démarrage.',
  setAutoUpdateCheck: 'Rechercher automatiquement les mises à jour',
  setAutoUpdateCheckDesc:
    'Désactivé, UniWork Office ne recherche plus de nouvelle version au démarrage ni en arrière-plan. Vous pouvez toujours vérifier via Aide › Rechercher des mises à jour.',
} satisfies Record<keyof typeof zh, string>
