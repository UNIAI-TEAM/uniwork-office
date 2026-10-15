import type { zh } from './zh'

export const ko = {
  aiRunUndo: '이번 실행 되돌리기',
  aiRunUndoDone: '실행을 되돌렸습니다',
  aiRunUndoLater:
    '이 실행 뒤에 다른 변경이 있습니다. 먼저 그 변경을 되돌린 다음 이번 실행을 되돌리세요.',
  aiRunUndoBusy: '어시스턴트가 끝나면 사용할 수 있습니다.',
  aiEditsPaused:
    '어시스턴트가 이 문서를 편집하고 있습니다. 직접 편집이 일시 중지되었습니다. 계속하려면 어시스턴트를 중지하세요.',
} satisfies Record<keyof typeof zh, string>
