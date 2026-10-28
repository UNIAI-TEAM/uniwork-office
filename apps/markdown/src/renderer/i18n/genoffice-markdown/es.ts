import type { zh } from './zh'

export const es = {
  backlinks: 'Retroenlaces',
  backlinksEmpty: 'Aún no hay notas que enlacen aquí.',
  backlinksRefresh: 'Actualizar retroenlaces',
  graph: 'Vista de grafo',
  graphClose: 'Cerrar el grafo',
  graphEmpty: 'El almacén aún no tiene notas.',
  graphTruncated: 'Demasiadas notas: el gráfico muestra las primeras {shown} de {total}.',
  suggestCreateNote: 'Crear nota nueva',
  tags: 'Etiquetas',
  tagsEmpty: 'Aún no hay #etiquetas en la bóveda',
} satisfies Record<keyof typeof zh, string>
