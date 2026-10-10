import type { zh } from './zh'

export const ko = {
  cloudTitle: 'UniWork 클라우드 AI',
  cloudStateReady: '사용 가능',
  cloudStateNotEntitled: '플랜에 포함되지 않음',
  cloudStateExhausted: 'AI 크레딧 소진',
  cloudStateUnavailable: '현재 사용할 수 없음',
  cloudStateSignedOut: '로그인하지 않음',
  cloudStateInactive: '구독이 활성 상태가 아님',
  cloudCredits: 'AI 크레딧',
  cloudCreditsLeft: '{remaining} / {limit} 남음',
  cloudCreditsUnlimited: '무제한',
  cloudCreditsRenews: '{date}에 갱신',
  cloudSignedOutBody:
    'UniWork에 로그인하면 조직의 AI 크레딧으로 웹 검색, 이미지 생성, 미디어 분석을 사용할 수 있습니다.',
  cloudNotEntitledBody:
    '조직의 플랜에 UniWork 클라우드 AI가 포함되어 있지 않습니다. 아래의 직접 설정한 제공자는 계속 사용할 수 있습니다.',
  cloudExhaustedBody:
    '조직이 이번 기간의 UniWork AI 크레딧을 모두 사용했습니다. 크레딧이 갱신될 때까지 클라우드 도구가 중지되며, 아래의 직접 설정한 제공자는 계속 작동합니다.',
  cloudUnavailableBody:
    'UniWork 클라우드 AI를 지금은 사용할 수 없습니다. 아래의 직접 설정한 제공자는 계속 작동합니다.',
  cloudInactiveBody:
    '조직의 UniWork 구독이 활성 상태가 아니어서 클라우드 AI가 일시 중지되었습니다. 관리자에게 갱신을 요청하세요. 아래의 자체 공급자는 계속 작동합니다.',
  cloudToolsOffBody:
    'UniWork 클라우드 도구가 꺼져 있습니다. 조직의 AI 크레딧을 사용하려면 {section}에서 “{switch}”를 켜세요. 아래의 자체 공급자에는 영향이 없습니다.',
  cloudReadyBody:
    '직접 설정한 제공자가 없으면 검색, 이미지 생성, 미디어 분석에 조직의 UniWork AI 크레딧이 사용됩니다.',
  cloudToolsToggle: 'UniWork 클라우드 도구 사용',
  cloudToolsToggleDesc:
    '직접 설정한 제공자가 없으면 웹 검색, 이미지 생성, 미디어 분석에 UniWork 클라우드를 사용합니다(AI 크레딧 차감).',
  cloudMediaLabel: 'UniWork 클라우드',
  cloudMediaDesc: '조직의 UniWork AI 크레딧을 사용하며 키가 필요 없습니다.',
  cloudSearchAutoHint: '먼저 UniWork 클라우드(AI 크레딧 차감), 그다음 무료 검색을 사용합니다.',
} satisfies Record<keyof typeof zh, string>
