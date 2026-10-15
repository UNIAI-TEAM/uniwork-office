import type { zh } from './zh'

export const ko = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: '크레딧 {limit} 중 {remaining} 남음',
  aiUniworkFooterSignIn: 'UniWork AI를 사용하려면 UniWork에 로그인하세요',
  aiUniworkSignedOut: 'UniWork에서 로그아웃되었습니다. 다른 제공자를 선택하거나 다시 로그인하세요.',
  aiUniworkOff: '이 문서에서는 UniWork AI가 꺼져 있습니다. 다른 제공자를 선택하세요.',
  aiUniworkViewOnly: '보기 전용: AI가 답변할 수는 있지만 문서를 편집하거나 저장할 수는 없습니다.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI는 저장하지 않은 변경 사항을 포함해 이 문서에 열려 있는 내용을 읽고, 답변을 위해 UniWork와 모델 제공자에게 보냅니다. 실행할 때마다 {org}의 AI 크레딧을 사용합니다. AI는 대신 저장하지 않으니 검토한 후 저장을 누르세요.',
  aiUniworkDisclosureLabel: 'UniWork AI가 받는 내용',
  aiUniworkDisclosureShort: '열린 콘텐츠(저장 안 된 내용 포함)를 UniWork로 보냄 · {org} 크레딧',
  aiUniworkLocalFile:
    '이 파일은 UniWork가 아니라 내 컴퓨터에 있습니다. UniWork AI를 사용하면 열린 파일의 내용이 UniWork로 전송되고 {org}의 AI 크레딧을 사용합니다. 파일은 UniWork 문서로 업로드되지 않습니다.',
  aiUniworkAck: '확인',
  aiUniworkLearnMore: '자세히 알아보기',
  aiUniworkDetails: '세부 정보',
  aiUniworkSendNeedsAck: '보내기 전에 안내를 읽고 확인하세요.',

  // S9 result chips and run controls
  aiResultAnswer: '답변',
  aiResultClarify: '설명 필요',
  aiResultEdited: '문서에서 편집됨',
  aiResultUnsupported: '지원되지 않음',
  aiResultError: '오류',
  aiResultEditedHint: '저장 안 됨 — Ctrl/⌘+Z로 실행 취소하거나, 괜찮으면 저장을 누르세요.',
  aiResultViewChanges: '변경 사항 보기',
  aiRunStop: '중지',
  aiRunSend: '보내기',
  aiRunRunning: '실행 중… 중지하려면 중지 또는 Esc를 누르세요.',
  aiRunStopped:
    '중지했습니다. 이미 적용된 변경 사항(있는 경우)은 문서에 남아 있으며 실행 취소할 수 있습니다.',
  aiRunRetry: '다시 시도',
  aiRunAskAgain: '다시 질문',
  aiRunChooseOther: '다른 제공자 선택',
  aiRunOpenInApp: '앱에서 열기',
  aiConversationRestarted:
    '이전 대화가 만료되어 UniWork AI가 새 대화를 시작했으며 이전 내용은 기억하지 않습니다. 계속하려면 질문을 다시 보내세요.',
  aiConversationBoundary: '{provider}와(과)의 새 대화: 위의 내용은 함께 보내지지 않습니다.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    '이번 실행이 UniWork AI의 단계 한도에 도달했습니다. 지금까지의 결과는 유지됩니다. 요청을 나눠서 다시 질문하세요.',
  aiErrCredits: '조직의 이번 기간 AI 크레딧이 모두 소진되었습니다. 이번 실행이 중지되었습니다.',
  aiErrEntitlement: '조직의 요금제에 더 이상 UniWork AI가 포함되어 있지 않습니다.',
  aiErrRateLimited: '너무 빠르게 보내고 있습니다. {seconds}초 후에 다시 시도하세요.',
  aiErrRateLimitedNoWait: '너무 빠르게 보내고 있습니다. 몇 분 후에 다시 시도하세요.',
  aiErrUnavailable:
    'UniWork AI가 지금 응답하지 않습니다. 문서와 저장 기능은 계속 사용할 수 있습니다.',
  aiErrGeneric:
    'UniWork AI에 예기치 않은 문제가 발생하여 이번 실행이 중지되었습니다. 문서와 저장 기능은 계속 사용할 수 있습니다.',
  aiErrDisconnected:
    '연결이 끊어져 이번 실행이 중지되었습니다. 이미 적용된 변경 사항(있는 경우)은 문서에 남아 있으며 실행 취소할 수 있습니다.',
  aiErrOffline:
    '오프라인 상태입니다. UniWork AI는 오프라인에서 실행되지 않으며 요청은 대기열에 추가되지 않습니다.',
  aiErrSession: 'UniWork 세션이 만료되어 이번 실행이 중지되었습니다. 계속하려면 다시 로그인하세요.',
  aiErrRevoked: '이 문서에 대한 액세스 권한이 없어져 AI 실행이 중지되었습니다.',
  aiErrDowngraded: '권한이 방금 보기 전용으로 바뀌어 AI가 편집을 중지했습니다. 답변은 계속됩니다.',
  aiErrCapabilityOff: '이 문서에서 UniWork AI가 방금 꺼져 현재 단계 이후 실행이 중지되었습니다.',
  aiErrUnsupported: 'UniWork AI는 아직 {module}에서 이 작업을 할 수 없습니다.',
  aiErrViewOnlyEdit: '이 문서에 대한 보기 권한만 있어 AI가 편집할 수 없습니다.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'UniWork AI에 보내기에는 요청이 너무 깁니다. 8,000자 미만으로 줄인 뒤 다시 보내세요.',
  aiErrQuestionRejected: 'UniWork AI가 이 요청을 받을 수 없습니다. 요청을 수정한 뒤 다시 보내세요.',
  aiUniworkImagesNotSent: '이미지는 UniWork AI로 전송되지 않으며 텍스트만 전송되었습니다.',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
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
  cloudInactiveBody:
    '조직의 UniWork 구독이 활성 상태가 아니어서 클라우드 AI가 일시 중지되었습니다. 관리자에게 갱신을 요청하세요. 아래의 자체 공급자는 계속 작동합니다.',
  acctSignIn: '로그인',
  acctSignInAgain: '다시 로그인',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart:
    '로컬 파일은 조직에서 새 대화를 시작하며 다른 파일의 대화 기록을 유지하지 않습니다.',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta: '기록한 셀: {written}({range}) · 덮어쓴 기존 셀: {overwritten}',
  aiResultCellsMetaNoOverwrite: '기록한 셀: {written}({range})',
  aiErrWorkbookTooLarge:
    '이 통합 문서는 너무 커서 웹에서 AI를 사용할 수 없습니다. UniWork Office 앱에서 여세요.',
  // S7 composer notice keys (not_entitled, credits_exhausted)
  not_entitled:
    '조직의 요금제에 UniWork AI가 포함되어 있지 않습니다. 조직 관리자에게 요금제를 문의하거나 설정 > AI 모델에서 직접 AI 키를 추가하세요.',
  credits_exhausted:
    '조직에서 이번 기간의 AI 크레딧을 모두 사용했습니다. 조직 관리자에게 크레딧 추가를 요청하거나 설정 > AI 모델에서 직접 AI 키를 추가하세요.',
} satisfies Record<keyof typeof zh, string>
