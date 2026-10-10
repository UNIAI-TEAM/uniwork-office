import type { zh } from './zh'

export const ko = {
  webCancel: '취소',
  webConflictTitle: '이 문서는 다른 곳에서 변경되었습니다',
  webConflictBody:
    '편집하는 동안 새 버전이 저장되었습니다. 내 버전으로 덮어쓰시겠습니까, 아니면 최신 버전을 다시 불러오고 변경 내용을 버리시겠습니까?',
  webConflictOverwrite: '덮어쓰기',
  webConflictReload: '최신 버전 다시 불러오기',
  webConflictNotSaved: '문서가 다른 곳에서 변경되었습니다',
  webFatalTitle: '문서를 열 수 없습니다',
  webFatalBody:
    '편집과 저장이 비활성화되었습니다. 페이지를 새로 고치거나 UniWork에서 문서를 다시 여세요.',
  webNoHost: '이 편집기는 UniWork 안에서 실행됩니다. UniWork에서 문서를 여세요.',
  webViewOnly: '보기 전용',
  webViewOnlyNotSaved: '이 문서는 보기 전용이라 저장할 수 없습니다',
  webNotUtf8:
    '이 파일은 UTF-8 텍스트가 아닙니다. 저장으로 내용이 바뀌지 않도록 보기 전용으로 엽니다',
  webDraftTitle: '저장하지 않은 변경 내용을 복원할까요?',
  webDraftBody:
    '이 브라우저에 이 문서의 저장하지 않은 변경 내용 사본이 남아 있습니다. 복원하거나 삭제하시겠습니까?',
  webDraftOlder: '이 사본은 문서의 이전 버전을 기반으로 합니다. 저장하면 최신 버전이 대체됩니다.',
  webDraftSavedAt: '사본 저장 시각',
  webDraftKept: '이 사본은 로그아웃할 때까지 이 브라우저에 보관됩니다.',
  webDraftRestore: '복원',
  webDraftDiscard: '삭제',
} satisfies Record<keyof typeof zh, string>
