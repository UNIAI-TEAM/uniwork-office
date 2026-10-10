import type { zh } from './zh'

export const ko = {
  webConflictTitle: '이 프레젠테이션이 다른 곳에서 변경되었습니다',
  webConflictBody:
    '누군가 최신 버전을 저장했습니다. 덮어쓰기는 내 변경 내용으로 바꾸고, 최신 버전 다시 불러오기는 내 변경 내용을 버리고 최신 버전을 엽니다.',
  webConflictOverwrite: '덮어쓰기',
  webConflictReload: '최신 버전 다시 불러오기',
  webConflictNotSaved: '프레젠테이션이 다른 곳에서 변경되었습니다',
  webDiscardTitle: '저장하지 않은 변경 내용을 버리시겠습니까?',
  webDiscardBody:
    '이 프레젠테이션에 저장하지 않은 변경 내용이 있습니다. 다른 파일을 열면 사라집니다.',
  webDiscard: '버리고 열기',
  webCancel: '취소',
  webOk: '확인',
  webFatalTitle: '프레젠테이션을 열 수 없습니다',
  webFatalBody: 'UniWork에서 파일을 불러오지 못했습니다. 이 탭을 닫고 다시 시도하세요.',
  webNoHost: '이 편집기는 UniWork 안에서 실행됩니다. UniWork에서 프레젠테이션을 여세요.',
  webLegacyPpt:
    '이전 .ppt 파일이라 브라우저에서 열 수 없습니다. 먼저 PowerPoint에서 .pptx로 저장하세요.',
  webEncryptedPptx: '이 프레젠테이션은 암호로 보호되어 브라우저에서 열 수 없습니다.',
  webCommentAuthor: '사용자',
  webExternalMedia: '연결된 외부 미디어는 데스크톱 앱에서만 재생됩니다.',
  webReadOnly: '이 프레젠테이션은 읽기 전용입니다.',
  webSaveNetwork: 'UniWork에 연결할 수 없습니다. 연결을 확인한 후 다시 시도하세요.',
  webSaveTimeout: '저장에 너무 오래 걸렸습니다. 연결을 확인한 후 다시 시도하세요.',
  webFullscreenHint: '클릭하거나 아무 키나 눌러 전체 화면으로 전환하세요',
} satisfies Record<keyof typeof zh, string>
