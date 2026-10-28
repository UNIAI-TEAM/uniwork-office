import type { zh } from './zh'

export const es = {
  searchMatchCase: 'Coincidir mayúsculas y minúsculas',
  searchWholeWord: 'Palabra completa',
  commentsPanel: 'Comentarios',
  commentsFilter: 'Filtrar comentarios por texto o autor',
  commentsEmpty: 'Aún no hay comentarios en este documento',
  commentsLoading: 'Cargando comentarios',
} satisfies Record<keyof typeof zh, string>
