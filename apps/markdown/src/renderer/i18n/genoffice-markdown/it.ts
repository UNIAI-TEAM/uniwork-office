import type { zh } from './zh'

export const it = {
  backlinks: 'Collegamenti inversi',
  backlinksEmpty: 'Ancora nessuna nota rimanda qui.',
  backlinksRefresh: 'Aggiorna i collegamenti inversi',
  graph: 'Vista grafo',
  graphClose: 'Chiudi il grafo',
  graphEmpty: 'La libreria non ha ancora note.',
  graphTruncated: 'Troppe note: il grafico mostra le prime {shown} su {total}.',
  suggestCreateNote: 'Crea nuova nota',
  tags: 'Tag',
  tagsEmpty: 'Ancora nessun #tag nel vault',
  blockLink: 'Copia link al blocco',
  blockLinkCopied: '{link} copiato',
  blockLinkNone: 'Niente da collegare qui',
  insertFootnote: 'Nota a piè di pagina',
  statusWords: '{n} parole',
  statusChars: '{n} caratteri',
  highlight: 'Evidenzia',
  diskChangedMsg: 'Questo file è stato modificato da un altro programma.',
  diskConflictMsg:
    'Questo file è cambiato su disco; il salvataggio sovrascriverà quelle modifiche.',
  diskReload: 'Ricarica',
  diskKeepMine: 'Mantieni il mio',
  diskOverwrite: 'Sovrascrivi comunque',
} satisfies Record<keyof typeof zh, string>
