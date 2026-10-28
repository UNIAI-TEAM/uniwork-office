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
  blockLink: 'Copiar enlace al bloque',
  blockLinkCopied: '{link} copiado',
  blockLinkNone: 'Aquí no hay ningún bloque que enlazar',
  insertFootnote: 'Nota al pie',
  statusWords: '{n} palabras',
  statusChars: '{n} caracteres',
  highlight: 'Resaltar',
} satisfies Record<keyof typeof zh, string>
