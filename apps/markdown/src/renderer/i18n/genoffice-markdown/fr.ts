import type { zh } from './zh'

export const fr = {
  backlinks: 'Rétroliens',
  backlinksEmpty: 'Aucune note ne pointe encore ici.',
  backlinksRefresh: 'Actualiser les rétroliens',
  graph: 'Vue graphe',
  graphClose: 'Fermer le graphe',
  graphEmpty: 'Le coffre n’a pas encore de notes.',
  graphTruncated: 'Trop de notes : le graphique affiche les {shown} premières sur {total}.',
} satisfies Record<keyof typeof zh, string>
