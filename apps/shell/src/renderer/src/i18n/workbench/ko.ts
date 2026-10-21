import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const ko = {
  ...en,
  wbNotif_document_changed: '{actor} 님이 문서 {count}개를 변경했습니다',
  wbNotif_document_changed_renamed_many: '{actor} 님이 문서 {count}개의 이름을 바꿨습니다',
  wbNotif_document_changed_renamed_one: '{actor} 님이 “{document}” 의 이름을 바꿨습니다',
  wbNotif_document_changed_renamed_untitled: '{actor} 님이 문서의 이름을 바꿨습니다',
  wbNotif_document_changed_moved_many: '{actor} 님이 문서 {count}개를 이동했습니다',
  wbNotif_document_changed_moved_one: '{actor} 님이 “{document}” 을(를) 이동했습니다',
  wbNotif_document_changed_moved_untitled: '{actor} 님이 문서를 이동했습니다',
  wbNotif_document_changed_trashed_many: '{actor} 님이 문서 {count}개를 휴지통으로 옮겼습니다',
  wbNotif_document_changed_trashed_one: '{actor} 님이 “{document}” 을(를) 휴지통으로 옮겼습니다',
  wbNotif_document_changed_trashed_untitled: '{actor} 님이 문서를 휴지통으로 옮겼습니다',
  wbNotif_document_changed_restored_many: '{actor} 님이 문서 {count}개를 복원했습니다',
  wbNotif_document_changed_restored_one: '{actor} 님이 “{document}” 을(를) 복원했습니다',
  wbNotif_document_changed_restored_untitled: '{actor} 님이 문서를 복원했습니다',
  wbNotif_document_changed_deleted_many: '{actor} 님이 문서 {count}개를 영구 삭제했습니다',
  wbNotif_document_changed_deleted_one: '{actor} 님이 “{document}” 을(를) 영구 삭제했습니다',
  wbNotif_document_changed_deleted_untitled: '{actor} 님이 문서를 영구 삭제했습니다',
  wbNotif_document_changed_shelved_many: '{actor} 님이 문서 {count}개를 보관했습니다',
  wbNotif_document_changed_shelved_one: '{actor} 님이 “{document}” 을(를) 보관했습니다',
  wbNotif_document_changed_shelved_untitled: '{actor} 님이 문서를 보관했습니다',
  wbNotif_document_changed_unshelved_many: '{actor} 님이 문서 {count}개의 보관을 해제했습니다',
  wbNotif_document_changed_unshelved_one: '{actor} 님이 “{document}” 의 보관을 해제했습니다',
  wbNotif_document_changed_unshelved_untitled: '{actor} 님이 문서의 보관을 해제했습니다',
  wbNotif_document_changed_access_changed_many:
    '{actor} 님이 문서 {count}개의 접근 권한을 변경했습니다',
  wbNotif_document_changed_access_changed_one:
    '{actor} 님이 “{document}” 의 접근 권한을 변경했습니다',
  wbNotif_document_changed_access_changed_untitled: '{actor} 님이 문서의 접근 권한을 변경했습니다',
  wbNotif_document_changed_version_created_many:
    '{actor} 님이 문서 {count}개에 새 버전을 추가했습니다',
  wbNotif_document_changed_version_created_one:
    '{actor} 님이 “{document}” 에 새 버전을 추가했습니다',
  wbNotif_document_changed_version_created_untitled: '{actor} 님이 문서에 새 버전을 추가했습니다',
  wbNotif_document_changed_relocated_many:
    '{actor} 님이 내 문서 {count}개가 들어 있는 폴더를 휴지통으로 옮겼습니다. 문서는 워크스페이스 최상위로 이동되었습니다',
  wbNotif_document_changed_relocated_one:
    '{actor} 님이 내 “{document}” 이(가) 들어 있는 폴더를 휴지통으로 옮겼습니다. 문서는 워크스페이스 최상위로 이동되었습니다',
  wbNotif_document_changed_relocated_untitled:
    '{actor} 님이 내 문서가 들어 있는 폴더를 휴지통으로 옮겼습니다. 문서는 워크스페이스 최상위로 이동되었습니다',
  wbNotif_document_changed_generic_one: '{actor} 님이 “{document}” 을(를) 변경했습니다',
  wbNotif_document_changed_generic_untitled: '{actor} 님이 문서를 변경했습니다',
  wbNotif_document_comment_resolved: '{actor} 님이 “{document}” 의 댓글을 해결됨으로 표시했습니다.',
  wbNotif_document_comment_resolved_untitled: '{actor} 님이 댓글을 해결됨으로 표시했습니다.',
  wbDeskPillChanged: '변경됨',
  wbDeskPillResolved: '해결됨',
  wbDocChangeTitle: '변경된 문서',
  wbDocChangeLoading: '문서를 불러오는 중',
  wbDocChangeEmptyTitle: '읽을 수 있는 문서가 남아 있지 않습니다',
  wbDocChangeEmptyDesc: '이 문서들은 삭제되었거나 더 이상 볼 권한이 없습니다.',
  wbDocChangeErrorTitle: '문서를 불러오지 못했습니다',
  wbDocChangeErrorDesc: '문제가 발생했습니다. 다시 시도하세요',
  wbDocChangeLoadMore: '더 보기',
  wbDocChangeLoadingMore: '불러오는 중…',
  wbDocChangeDeleted: '영구 삭제됨',
  wbDocChangeInTrash: '휴지통으로 이동됨',
  wbDocChangeUntitled: '제목 없는 문서',
  wbDocChangeViewList: '문서 {count}개 보기',
  wbDocChangeMore: '외 {count}개',
} satisfies Record<keyof typeof zh, string>
