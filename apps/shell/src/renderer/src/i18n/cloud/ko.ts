import type { zh } from './zh'

export const ko = {
  cloudTitle: 'UniWork 클라우드 AI',
  cloudStateReady: '사용 가능',
  cloudStateNotEntitled: '플랜에 포함되지 않음',
  cloudStateExhausted: 'AI 크레딧 소진',
  cloudStateUnavailable: '현재 사용할 수 없음',
  cloudStateInactive: '구독이 활성 상태가 아님',
  cloudCredits: 'AI 크레딧',
  cloudCreditsLeft: '{remaining} / {limit} 남음',
  cloudCreditsUnlimited: '무제한',
  cloudCreditsRenews: '{date}에 갱신',
  cloudToolsToggle: 'UniWork 클라우드 도구 사용',
  cloudToolsToggleDesc:
    '직접 설정한 제공자가 없으면 웹 검색, 이미지 생성, 미디어 분석에 UniWork 클라우드를 사용합니다(AI 크레딧 차감).',
} satisfies Record<keyof typeof zh, string>
