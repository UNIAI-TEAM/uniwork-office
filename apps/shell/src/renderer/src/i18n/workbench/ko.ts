import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const ko = {
  ...en,
  wbNotif_document_commented_untitled: '{actor}님이 문서에 댓글을 남겼습니다',
  wbNotif_document_mentioned: '{actor}님이 “{document}”의 댓글에서 회원님을 멘션했습니다.',
  wbNotif_document_mentioned_untitled: '{actor}님이 문서의 댓글에서 회원님을 멘션했습니다.',
  wbNotif_document_body_mentioned: '{actor}님이 “{document}”에서 회원님을 멘션했습니다.',
  wbNotif_document_body_mentioned_untitled: '{actor}님이 문서에서 회원님을 멘션했습니다.',
  wbNotif_document_comment_replied: '{actor}님이 “{document}”의 회원님 댓글에 답글을 남겼습니다.',
  wbNotif_document_comment_replied_untitled: '{actor}님이 문서의 회원님 댓글에 답글을 남겼습니다.',
  wbNotif_document_discussion_mentioned:
    '{actor}님이 “{document}”의 토론에서 회원님을 멘션했습니다.',
  wbNotif_document_discussion_mentioned_untitled:
    '{actor}님이 문서의 토론에서 회원님을 멘션했습니다.',
  wbNotif_document_discussion_replied:
    '{actor}님이 “{document}”의 회원님 토론 글에 답글을 남겼습니다.',
  wbNotif_document_discussion_replied_untitled:
    '{actor}님이 문서의 회원님 토론 글에 답글을 남겼습니다.',
  wbNotif_document_edit_requested: '{actor}님이 “{document}”을(를) 편집하고 싶어 합니다',
  wbNotif_document_edit_request_answered:
    '{actor}님이 “{document}”의 편집 권한을 회원님께 넘겼습니다',
  wbNotif_document_edit_request_answered_declined:
    '{actor}님이 아직 “{document}”을(를) 편집 중입니다',
  wbNotif_document_edit_taken_over:
    '{actor}님이 “{document}”의 편집을 이어받았습니다. 저장하지 않은 변경 사항은 열린 문서에 그대로 남아 있습니다.',
  wbNotif_document_break_glass:
    '{actor}님이 “{document}”에 대한 긴급 보기 권한(24시간)을 열었습니다.',
  wbNotif_document_break_glass_untitled:
    '{actor}님이 문서에 대한 긴급 보기 권한(24시간)을 열었습니다.',
  wbNotif_document_access_requested: '{actor}님이 “{document}”에 대한 접근을 요청했습니다.',
  wbNotif_document_access_requested_untitled: '{actor}님이 문서에 대한 접근을 요청했습니다.',
  wbNotif_document_access_approved:
    '{actor}님이 “{document}”에 대한 접근 권한을 회원님께 주었습니다.',
  wbNotif_document_access_approved_untitled:
    '{actor}님이 문서에 대한 접근 권한을 회원님께 주었습니다.',
  wbNotif_document_access_declined: '문서 접근 요청이 거절되었습니다.',
  wbNotif_document_shared: '{actor}님이 “{document}”을(를) 회원님과 공유했습니다({level}).',
  wbNotif_document_shared_untitled: '{actor}님이 문서를 회원님과 공유했습니다({level}).',
  wbNotif_document_shared_nolevel: '{actor}님이 “{document}”을(를) 회원님과 공유했습니다.',
  wbNotif_document_shared_untitled_nolevel: '{actor}님이 문서를 회원님과 공유했습니다.',
  wbNotif_document_shared_folder:
    '{actor}님이 “{document}” 폴더의 문서 {count}개를 회원님과 공유했습니다({level}).',
  wbNotif_document_shared_folder_untitled:
    '{actor}님이 폴더의 문서 {count}개를 회원님과 공유했습니다({level}).',
  wbNotif_document_shared_folder_nolevel:
    '{actor}님이 “{document}” 폴더의 문서 {count}개를 회원님과 공유했습니다.',
  wbNotif_document_shared_folder_untitled_nolevel:
    '{actor}님이 폴더의 문서 {count}개를 회원님과 공유했습니다.',
  wbNotif_document_owner_transferred:
    '{actor}님이 “{document}”의 소유권을 회원님에게 이전했습니다.',
  wbNotif_document_owner_transferred_untitled:
    '{actor}님이 문서의 소유권을 회원님에게 이전했습니다.',
  wbNotif_document_trashed_by_other:
    '{actor}님이 회원님의 문서를 휴지통으로 옮겼습니다. {date}까지 복원하세요',
  wbNotif_document_trashed_by_other_untitled:
    '{actor}님이 회원님의 문서 중 하나를 휴지통으로 옮겼습니다. {date}까지 복원하세요',
  wbNotif_document_trashed_by_other_nodate: '{actor}님이 회원님의 문서를 휴지통으로 옮겼습니다',
  wbNotif_document_trashed_by_other_untitled_nodate:
    '{actor}님이 회원님의 문서 중 하나를 휴지통으로 옮겼습니다',
  wbNotif_chat_call_incoming: '{actor}님이 전화를 걸고 있습니다',
  wbNotifFallback: '새 알림',
  wbNotif_audit_export_ready: '감사 로그 내보내기가 준비되었습니다',
  wbNotif_chat_dm: '{actor}님이 메시지를 보냈습니다',
  wbNotif_chat_follow_up: '메시지에 후속 알림을 저장했습니다',
  wbNotif_chat_mentioned: '{actor}님이 {room}에서 회원님을 언급했습니다',
  wbNotif_chat_reminder: '리마인더: {body}',
  wbNotif_chat_thread_replied: '{actor}님이 {room}의 스레드에 답글을 달았습니다',
  wbNotif_document_commented: '{actor}님이 “{document}”에 댓글을 남겼습니다',
  wbNotif_email_hub_new_mail: '읽지 않은 메시지: {count}개 · {mailbox}',
  wbNotif_meeting_invited: '{actor}님이 “{meeting}”에 회원님을 초대했습니다',
  wbNotif_meeting_starting: '“{meeting}”이(가) {minutes}분 후에 시작합니다',
  wbNotif_meeting_summary_reminder: '“{meeting}”이(가) 끝났습니다 · 요약하고 할 일을 만드세요',
  wbNotif_member_added: '{actor}님이 회원님을 워크스페이스 {workspace}에 추가했습니다',
  wbNotif_mentioned: '{actor}님이 “{task}”에서 회원님을 언급했습니다',
  wbNotif_role_changed: '{actor}님이 회원님의 역할을 {role}(으)로 변경했습니다',
  wbNotif_task_assigned: '{actor}님이 “{task}” 작업을 회원님에게 할당했습니다',
  wbNotif_task_commented: '{actor}님이 “{task}”에 댓글을 남겼습니다',
  wbNotif_task_status_changed: '{actor}님이 “{task}”을(를) {status} 상태로 옮겼습니다',
  wbDeskPillComment: '댓글',
  wbDeskPillMention: '멘션',
  wbDeskPillShared: '새 공유',
  wbDeskPillReply: '답글',
  wbDeskPillEdit: '편집 중',
  wbDeskPillAccess: '접근',
  wbDeskPillTrash: '휴지통',
  wbDeskPillBreakGlass: '긴급',
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
  wbDocChangeMore: '외 {count}개',
  wbNoticeNoAccess: '이 문서에 접근할 권한이 없습니다.',
  wbTabCountUnread: '읽지 않은 알림: {count}',
} satisfies Record<keyof typeof zh, string>
