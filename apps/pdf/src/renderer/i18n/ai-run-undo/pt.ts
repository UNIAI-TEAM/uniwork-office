import type { zh } from './zh'

export const pt = {
  aiRunUndo: 'Desfazer esta execução',
  aiRunUndoDone: 'Execução desfeita',
  aiRunUndoLater:
    'Há alterações feitas depois desta execução. Desfaça-as primeiro e depois desfaça a execução.',
  aiRunUndoBusy: 'Disponível quando o assistente terminar.',
} satisfies Record<keyof typeof zh, string>
