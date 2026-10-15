import type { zh } from './zh'

export const vi = {
  // panel and panel states
  collabComments: 'Bình luận',
  collabDiscussion: 'Thảo luận',
  collabClosePanel: 'Đóng {panel}',
  collabLabelCount: '{label} · {count}',
  collabLoading: 'Đang tải…',
  collabEmptyComments: 'Chưa có bình luận. Chọn một chỗ trong tài liệu rồi chọn Bình luận.',
  collabEmptyDiscussion: 'Chưa có thảo luận. Hãy viết điều bạn muốn trao đổi về tài liệu này.',
  collabLoadError: 'Không tải được nội dung này',
  collabLoadErrorBody: 'Chưa mất gì cả. Thử lại sau giây lát.',
  collabRetry: 'Thử lại',
  collabOffline:
    'Không kết nối được UniWork. Bạn vẫn đọc được nội dung đã tải nhưng chưa gửi được.',
  collabServerError:
    'UniWork đang gặp sự cố. Bạn vẫn đọc được nội dung đã tải nhưng chưa gửi được.',
  collabSignedOut: 'Phiên đăng nhập đã hết. Đăng nhập lại để gửi.',
  collabNoAccess: 'Bạn không còn quyền xem nội dung này',
  collabNoAccessBody: 'Nội dung bị ẩn theo quyền hiện tại của bạn trên tài liệu này.',
  collabViewOnlyBadge: 'Chỉ xem',
  collabViewOnly: 'Bạn chỉ có quyền xem: đọc được nhưng không viết được.',
  collabUpdatedAnnounce: 'Nội dung vừa được cập nhật.',

  // anchors
  collabAnchorDocx: 'Đoạn: “{quote}”',
  collabAnchorCell: 'Ô {cell}',
  collabAnchorSlide: 'Trang chiếu {slide}',
  collabAnchorPage: 'Trang {page}',
  collabAnchorStale: 'Vị trí có thể đã thay đổi',
  collabAnchorLost: 'Không còn tìm thấy vị trí được bình luận',
  collabGoToAnchor: 'Đến vị trí',

  // thread, actions, history
  collabResolved: 'Đã giải quyết',
  collabResolve: 'Giải quyết',
  collabReopen: 'Mở lại',
  collabReply: 'Trả lời',
  collabReplyCount: 'Trả lời: {count}',
  collabActions: 'Thao tác khác',
  collabEdit: 'Sửa',
  collabSave: 'Lưu',
  collabCancel: 'Hủy',
  collabDelete: 'Xóa',
  collabCopyText: 'Sao chép nội dung',
  collabDeleteTitle: 'Xóa nội dung này?',
  collabDeleteBody:
    'Nội dung và lịch sử sửa sẽ bị xóa hẳn. Nếu đã có trả lời, các trả lời vẫn còn.',
  collabDeleteConfirm: 'Xóa hẳn',
  collabDeleted: 'Nội dung đã bị xóa',
  collabEdited: 'Đã sửa · {time}',
  collabFormerMember: 'Cựu thành viên',
  collabHistory: 'Xem lịch sử sửa',
  collabHistoryTitle: 'Lịch sử sửa',
  collabHistoryCurrent: 'Bản hiện tại',
  collabHistoryEntry: '{name}, {time}',
  collabHistoryEmpty: 'Nội dung này chưa được sửa.',
  collabHistoryError: 'Không tải được lịch sử sửa.',
  collabActionFailed: 'Thao tác chưa thành công',

  // composer
  collabComposerComment: 'Viết bình luận…',
  collabComposerReply: 'Viết trả lời…',
  collabComposerDiscussion: 'Viết vào thảo luận…',
  collabSend: 'Gửi',
  collabSendHint: '{shortcut} để gửi',
  collabSending: 'Đang gửi…',
  collabSendFailed: 'Chưa gửi được. Nội dung vẫn còn trong ô soạn.',
  collabCommentDeleted: 'Bình luận này đã bị xóa.',
  collabDiscussionDeleted: 'Bài thảo luận này đã bị xóa.',
  collabDiscardTitle: 'Bỏ bản nháp?',
  collabDiscardBody: 'Nội dung bạn đang viết sẽ mất.',
  collabDiscard: 'Bỏ nháp',
  collabKeepWriting: 'Tiếp tục viết',
  collabAiDraftLabel: 'Bản nháp do UniWork AI gợi ý. Xem lại rồi bấm Gửi.',

  // comments stored in the file (read-only)
  collabInFileSection: 'Bình luận trong tệp',
  collabInFileHint: 'Lưu sẵn trong tệp và chỉ để xem: không sửa hay trả lời được ở đây.',

  // mention access warning & post-send notice
  collabMentionWarnTitle: 'Người được nhắc chưa có quyền xem',
  collabMentionWarnBody: '{names} chưa xem được tài liệu này nên sẽ không nhận thông báo.',
  collabShareViewThenSend: 'Chia sẻ quyền Xem rồi gửi',
  collabSendWithoutNotify: 'Gửi, không thông báo',
  collabMentionAskManager: 'Hãy nhờ người quản lý tài liệu chia sẻ quyền Xem cho {names}.',
  collabMentionMixedUnshareable:
    'Không thể chia sẻ cho {unshareable}; những người này sẽ không nhận thông báo.',
  collabSharingView: 'Đang chia sẻ quyền Xem…',
  collabShareViewFailed:
    'Chưa chia sẻ được quyền Xem cho {failedNames}. Bạn có thể thử lại hoặc gửi mà không thông báo.',
  collabShareViewPartial:
    'Đã chia sẻ quyền Xem cho {sharedNames}. Chưa chia sẻ được cho {failedNames} (sẽ không nhận thông báo).',
  collabSendComment: 'Gửi bình luận',
  collabRetryShareFor: 'Thử lại cho {failedNames}',
  collabSendFailedAfterShare:
    'Đã chia sẻ quyền Xem cho {sharedNames} nhưng chưa gửi được bình luận. Nội dung vẫn còn trong ô soạn — hãy thử gửi lại.',
  collabPostSendNoAccess: '{names} chưa xem được tài liệu này nên đã không nhận thông báo.',
  collabPostSendShareAction: 'Chia sẻ quyền Xem',
  collabPostSendNoRetroNote:
    'Chia sẻ lúc này không gửi lại thông báo cho bình luận trên; hãy nhắc lại họ ở bình luận mới nếu cần.',
} satisfies Record<keyof typeof zh, string>
