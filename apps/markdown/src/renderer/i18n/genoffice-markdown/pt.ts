import type { zh } from './zh'

export const pt = {
  backlinks: 'Retro-ligações',
  backlinksEmpty: 'Ainda nenhuma nota liga aqui.',
  backlinksRefresh: 'Atualizar retro-ligações',
  graph: 'Vista de grafo',
  graphClose: 'Fechar o grafo',
  graphEmpty: 'O cofre ainda não tem notas.',
  graphTruncated: 'Notas demais: o gráfico mostra as primeiras {shown} de {total}.',
  suggestCreateNote: 'Criar nova nota',
  tags: 'Etiquetas',
  tagsEmpty: 'Ainda não há #etiquetas no cofre',
  blockLink: 'Copiar link para o bloco',
  blockLinkCopied: '{link} copiado',
  blockLinkNone: 'Nada aqui para vincular',
} satisfies Record<keyof typeof zh, string>
