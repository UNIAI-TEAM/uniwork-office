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
  webReloaded: '최신 버전을 다시 불러왔으며 변경 내용은 삭제되었습니다',
  webViewOnlyNoSave: '이 문서는 보기 전용입니다',
  webMergeTitle: 'PDF 병합',
  webMergeBody: 'PDF {count}개를 선택했습니다. PDF를 더 추가할까요, 아니면 지금 병합할까요?',
  webMergeAdd: 'PDF 더 추가',
  webMergeNow: '지금 병합',
} satisfies Record<keyof typeof zh, string>
