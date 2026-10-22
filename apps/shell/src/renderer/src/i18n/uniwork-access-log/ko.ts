import type { zh } from './zh'

export const ko = {
  algMenu: '액세스 로그',
  algTitle: '액세스 로그',
  algDescription:
    '누가 문서를 조회하거나 다운로드하거나 링크로 열었는지 보여줍니다. 관리자만 볼 수 있습니다.',
  algManageOnly: '액세스 로그를 보려면 관리 권한이 필요합니다.',
  algLoading: '로그를 불러오는 중…',
  algError: '액세스 로그를 불러오지 못했습니다.',
  algEmpty: '기록된 액세스가 아직 없습니다.',
  algFilterLabel: '작업',
  algFilterAll: '모든 작업',
  algActionView: '조회',
  algActionDownload: '다운로드',
  algActionExport: '내보내기',
  algActionLinkView: '링크로 열기',
  algActionUnknown: '기타',
  algActorAnonymous: '익명',
  algActorSystem: '시스템',
  algActorUnknown: '알 수 없음',
  algVersion: '버전 {no}',
} satisfies Record<keyof typeof zh, string>
