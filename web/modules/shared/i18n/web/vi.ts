import type { zh } from './zh'

export const vi = {
  webCancel: 'Hủy',
  webConflictTitle: 'Tài liệu này đã được thay đổi ở nơi khác',
  webConflictBody:
    'Thay đổi của bạn chưa lưu lên UniWork và vẫn được giữ trong trình duyệt này cho tới khi bạn đăng xuất.',
  webConflictOverwrite: 'Ghi đè…',
  webConflictReload: 'Tải lại bản mới nhất',
  webConflictNotSaved: 'tài liệu đã được thay đổi ở nơi khác',
  webFatalTitle: 'Không thể mở tài liệu',
  webFatalBody: 'Đã tắt chỉnh sửa và lưu. Hãy tải lại trang hoặc mở lại tài liệu từ UniWork.',
  webNoHost: 'Trình soạn thảo này chạy bên trong UniWork. Hãy mở tài liệu từ UniWork.',
  webViewOnly: 'Chỉ xem',
  webViewOnlyNotSaved: 'Tài liệu này chỉ xem, không thể lưu',
  webNotUtf8:
    'Tệp này không phải văn bản UTF-8. Tệp được mở ở chế độ chỉ xem để việc lưu không làm thay đổi nội dung',
  webDraftTitle: 'Khôi phục các thay đổi chưa lưu?',
  webDraftBody:
    'Trình duyệt này đã giữ một bản sao các thay đổi chưa lưu của tài liệu này. Khôi phục hay bỏ các thay đổi đó?',
  webDraftOlder:
    'Bản sao dựa trên một phiên bản cũ hơn của tài liệu. Lưu bản sao sẽ thay thế phiên bản mới hơn.',
  webDraftSavedAt: 'Bản sao được giữ lúc',
  webDraftKept: 'Trình duyệt này giữ bản sao cho đến khi bạn đăng xuất.',
  webDraftRestore: 'Khôi phục',
  webDraftDiscard: 'Bỏ',
  webSaveNetwork: 'Không kết nối được tới UniWork. Hãy kiểm tra mạng rồi thử lại.',
  webSaveTimeout: 'Việc lưu mất quá nhiều thời gian. Hãy kiểm tra mạng rồi thử lại.',
  webClose: 'Đóng',
  webSaveUnauthorized: 'Phiên UniWork của bạn đã hết hạn. Hãy đăng nhập lại rồi thử lưu lần nữa.',
  webSaveForbidden: 'Bạn không có quyền lưu tài liệu này.',
  webSaveNotFound: 'Tài liệu này không còn tồn tại hoặc đã được di chuyển.',
  webSaveTooLarge: 'Tài liệu quá lớn để lưu.',
  webSaveRateLimited: 'Quá nhiều yêu cầu. Hãy chờ một lát rồi thử lại.',
  webSaveServer: 'UniWork gặp sự cố khi lưu. Hãy thử lại sau ít phút.',
  webSaveFailedGeneric: 'Không lưu được tài liệu. Hãy thử lại.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Thay đổi của bạn chưa lưu lên UniWork và vẫn được giữ trong trình duyệt này cho tới khi bạn đăng xuất.',
  uwConflictReloadWebBody:
    'Trình duyệt không giữ nháp xung đột. Tải bản của bạn về máy để chép lại sau, hoặc bỏ thay đổi.',
  uwConflictDownloadThenReload: 'Tải bản của tôi về máy rồi tải lại',
  uwConflictDiscardThenReload: 'Bỏ thay đổi và tải lại',
  uwConflictMineFileSuffix: '(bản của tôi)',
  uwConflictDownloadCheck:
    'Trình duyệt đã nhận tệp bản của bạn. Hãy kiểm tra tệp đã được lưu, rồi bấm Tải lại.',
  uwConflictSessionWeb:
    'Phiên đăng nhập đã hết hạn nên chưa ghi đè được. Thay đổi vẫn được giữ trong trình duyệt này; đăng nhập lại rồi thử lại.',
  uwConflictTooLarge: 'Bản của bạn vượt giới hạn kích thước của UniWork nên chưa ghi đè được.',
  uwConflictDownloadTooLarge:
    'Bản của bạn vượt giới hạn kích thước của UniWork nên không tải xuống được ở đây.',
  uwConflictDownloadFailed:
    'Chưa tải được bản của bạn về máy nên tài liệu chưa được tải lại. Hãy thử lại.',
  uwConflictOfflineWeb:
    'Không có mạng. Trên web, lựa chọn này cần kết nối; thay đổi vẫn được giữ trong trình duyệt.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Bản của bạn',
  uwConflictColServer: 'Bản trên UniWork',
  uwConflictRowVersion: 'Phiên bản',
  uwConflictRowTime: 'Thời điểm',
  uwConflictRowBy: 'Người lưu',
  uwConflictMineUnsaved: 'Bạn (chưa lưu)',
  uwConflictBasedOn: 'dựa trên phiên bản {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Xem khác biệt',
  uwConflictNoEdit: 'Bạn không còn quyền sửa tài liệu này.',
  uwConflictOverwriteTitle: 'Ghi đè bằng bản của bạn?',
  uwConflictOverwriteConfirm:
    'UniWork sẽ tạo phiên bản {next} từ bản của bạn. Phiên bản {server} của {author} vẫn còn trong lịch sử.',
  uwConflictOverwriteGo: 'Ghi đè',
  uwConflictBack: 'Quay lại',
  uwConflictHeadMoved: 'Trong lúc đó UniWork đã có phiên bản {n}. Bảng đã cập nhật; hãy chọn lại.',
  uwConflictReloadTitle: 'Tải lại bản mới nhất',
  uwConflictReloadGo: 'Tải lại',
  uwConflictSaveCopy: 'Lưu thành bản sao…',
  uwConflictSaveCopyTitle: 'Lưu thành bản sao?',
  uwConflictSaveCopyConfirm:
    'UniWork sẽ tạo một tài liệu mới từ bản của bạn, cùng chủ sở hữu và quyền truy cập với tài liệu này. Tài liệu hiện tại và phiên bản {server} của {author} không đổi.',
  uwConflictSaveCopyGo: 'Tạo bản sao',
  uwConflictSaveCopyDone:
    'Đã lưu bản của bạn thành tài liệu mới: {title}. Tài liệu này chưa đổi; bạn vẫn chọn được Tải lại hoặc Ghi đè.',
  uwConflictSaveCopyFailed: 'Chưa tạo được bản sao. Thay đổi của bạn vẫn an toàn; hãy thử lại.',
  uwConflictSaveCopyOffline:
    'Không có mạng. Tạo bản sao cần kết nối; thay đổi của bạn vẫn được giữ.',
  uwConflictReloadFailed:
    'Không tải được bản mới nhất. Tài liệu của bạn chưa thay đổi; hãy thử lại.',
  uwConflictOverwriteFailed: 'Chưa ghi đè được. Tài liệu của bạn chưa thay đổi; hãy thử lại.',
  uwConflictClose: 'Đóng',

  // S6 new-version bar
  uwRemoteRegion: 'Phiên bản mới',
  uwRemoteUpdated: 'Đã cập nhật lên phiên bản {n} do {author} lưu lúc {time}.',
  uwRemoteUpdatedNoRev: 'Đã cập nhật lên phiên bản mới nhất trên UniWork.',
  uwRemoteNewerDirty:
    'Có phiên bản mới hơn trên UniWork (phiên bản {n}). Thay đổi của bạn chưa lưu nên tài liệu không tự tải lại.',
  uwRemoteNewerAi:
    'Có phiên bản mới hơn trên UniWork (phiên bản {n}). UniWork AI đang chạy nên tài liệu không tự tải lại; kết quả AI chỉ áp dụng cho bản đang mở.',
  uwRemoteNowClean: 'Bạn đã hoàn tác hết thay đổi. Phiên bản {n} trên UniWork mới hơn bản đang mở.',
  uwRemoteStopAiConfirm:
    'Dừng lượt UniWork AI đang chạy để tải lại? Thay đổi AI đã áp dụng sẽ theo bản đang mở.',
  uwRemoteWaitCommit: 'Đang chờ lần lưu đang gửi hoàn tất; tải lại được sau đó.',
  uwRemoteReload: 'Tải lại bản mới nhất…',
  uwRemoteLater: 'Để sau',
  uwRemoteClose: 'Đóng',
  uwRemoteReloadFailed: 'Không tải được phiên bản {n}. Bạn vẫn đang xem bản trước.',
  uwRemoteDeleted: 'Tài liệu này đã bị xóa trên UniWork. Các lần lưu đang chờ đã dừng.',
  uwAuthorFallback: 'một thành viên',
  uwLockRegion: 'Trạng thái tài liệu',
  uwActRetry: 'Thử lại',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'Bạn không còn quyền truy cập tài liệu này. Đã dừng lưu; thay đổi chưa lưu được giữ trong trình duyệt này cho tới khi bạn đăng xuất.',
  uwRemoteOrgBlockedWeb:
    'Không lưu được: {reason}. Thay đổi chưa lưu được giữ trong trình duyệt này cho tới khi bạn đăng xuất.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'tài liệu đã được lưu trữ',
  uwReasonSuspended: 'tổ chức đang bị tạm ngưng',
  uwReasonDeactivated: 'tài khoản của bạn đã bị vô hiệu hóa trong tổ chức',
} satisfies Record<keyof typeof zh, string>
