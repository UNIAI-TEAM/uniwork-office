import type { zh } from './zh'

export const pt = {
  aiRunUndo: 'Desfazer esta execução',
  aiRunUndoDone: 'Execução desfeita',
  aiRunUndoLater:
    'Há alterações feitas depois desta execução. Desfaça-as primeiro e depois desfaça a execução.',
  aiRunUndoBusy: 'Disponível quando o assistente terminar.',
  aiEditsPaused:
    'O assistente está editando este documento. Suas edições estão pausadas; pare o assistente para continuar.',
} satisfies Record<keyof typeof zh, string>
