import type { zh } from './zh'

export const ko = {
  setRestoreSession: '지난번 문서 다시 열기',
  setRestoreSessionDesc:
    'UniWork Office를 닫을 때 열려 있던 문서를 다음 실행 시 자동으로 다시 엽니다.',
  setAutoUpdateCheck: '자동으로 업데이트 확인',
  setAutoUpdateCheckDesc:
    '끄면 실행 시나 백그라운드에서 새 버전을 확인하지 않습니다. 도움말 › 업데이트 확인에서 직접 확인할 수 있습니다.',
} satisfies Record<keyof typeof zh, string>
