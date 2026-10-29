import type { zh } from './zh'

export const ko = {
  aiWebClose: '닫기',
  aiWebStateCreditsTitle: 'AI 크레딧 소진',
  aiWebStateCreditsBody:
    '조직이 이번 기간의 UniWork AI 크레딧을 모두 사용했습니다. 관리자에게 문의하거나 갱신을 기다리세요.',
  aiWebStateEntitlementTitle: '요금제에 AI가 없습니다',
  aiWebStateEntitlementBody:
    '조직의 UniWork 요금제에 이 AI 기능이 포함되어 있지 않습니다. 관리자에게 문의하세요.',
  aiWebStateRateTitle: 'AI 요청이 너무 많음',
  aiWebStateRateBody: '{seconds}초 후에 다시 시도하세요.',
  aiWebStateRateBodyNow: '잠시 후 다시 시도하세요.',
  aiWebStateUnreachableTitle: 'AI 공급자에 연결할 수 없음',
  aiWebStateUnreachableBody: 'UniWork가 AI 공급자에 연결하지 못했습니다. 잠시 후 다시 시도하세요.',
  aiWebStateCloudTitle: '클라우드 도구 사용 불가',
  aiWebStateCloudBody: '이 UniWork AI 도구는 아직 서버에 설정되지 않았습니다.',
  aiWebStateOutageTitle: 'UniWork를 일시적으로 사용할 수 없음',
  aiWebStateOutageBody: '지금은 UniWork에 연결할 수 없습니다. 잠시 후 다시 시도하세요.',
  aiWebStateSessionTitle: '세션 만료',
  aiWebStateSessionBody: '계속하려면 UniWork에서 문서를 다시 여세요.',
  aiWebStateRefusedTitle: '요청 거부됨',
  aiWebStateRefusedBody: '서버가 AI 요청을 거부했습니다.',
  aiWebStateUnknownTitle: 'AI 요청 실패',
  aiWebStateUnknownBody: '문제가 발생했습니다. 다시 시도하세요.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    '이 통합 문서는 너무 커서 웹에서 AI를 사용할 수 없습니다. UniWork Office 앱에서 여세요.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: '다음 부분을 이어서 진행하세요.',
} satisfies Record<keyof typeof zh, string>
