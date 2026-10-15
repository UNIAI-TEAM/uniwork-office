import type { zh } from './zh'

export const ko = {
  aiRunUndo: '이번 실행 되돌리기',
  aiRunUndoDone: '실행을 되돌렸습니다',
  aiRunUndoLater:
    '이 실행 뒤에 다른 변경이 있습니다. 먼저 그 변경을 되돌린 다음 이번 실행을 되돌리세요.',
  aiRunUndoBusy: '어시스턴트가 끝나면 사용할 수 있습니다.',
} satisfies Record<keyof typeof zh, string>
