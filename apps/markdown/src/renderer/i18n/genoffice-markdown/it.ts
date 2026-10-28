import type { zh } from './zh'

export const it = {
  backlinks: 'Collegamenti inversi',
  backlinksEmpty: 'Ancora nessuna nota rimanda qui.',
  backlinksRefresh: 'Aggiorna i collegamenti inversi',
  graph: 'Vista grafo',
  graphClose: 'Chiudi il grafo',
  graphEmpty: 'La libreria non ha ancora note.',
  graphTruncated: 'Troppe note: il grafico mostra le prime {shown} su {total}.',
} satisfies Record<keyof typeof zh, string>
