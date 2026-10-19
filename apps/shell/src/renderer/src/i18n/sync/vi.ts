import type { zh } from './zh'

export const vi = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Đã xếp hàng lưu — chưa lưu lên UniWork',
  uwChipQueuedNewer: 'Đã xếp hàng lưu · có thay đổi mới',
  uwChipPausedAdmin: 'Đã xếp hàng lưu · tạm dừng gửi',
  uwChipReconciling: 'Đang kiểm tra lần lưu trước…',
  uwChipReconcileStuck: 'Cần hỗ trợ để xác nhận lần lưu',
  uwErrReconcileStuck: 'Cần hỗ trợ để xác nhận lần lưu.',
  uwChipRemoteNewer: 'Có phiên bản mới hơn trên UniWork',
  uwTipQueued: 'Bản lưu lúc {time} được giữ an toàn trên máy này và sẽ gửi khi có thể.',
  uwTipQueuedNewer: 'Bản lúc {time} đang chờ gửi. Thay đổi sau đó chưa nằm trong lần lưu này.',
  uwTipPausedAdmin: 'Quản trị viên đang tạm dừng việc gửi. Bản lưu được giữ trên máy này.',
  uwTipPausedUser:
    'Bạn đang tạm dừng gửi. Bản lưu lúc {time} được giữ trên máy này; bấm "Tiếp tục gửi" trong trung tâm đồng bộ.',
  uwTipReconciling:
    'Chưa rõ lần lưu trước đã tới UniWork chưa. Ứng dụng đang hỏi lại và sẽ không tạo bản trùng.',
  uwTipRemoteNewer: 'Thay đổi của bạn chưa lưu nên tài liệu không tự tải lại.',
  uwTipFailed: 'Lần lưu này sẽ không tự thử lại: {reason}. Thay đổi vẫn trên máy này.',
  uwTipWaitAi: 'Đang chờ AI xong bước hiện tại rồi lưu.',
  uwTipWaitAiLong: 'AI chưa xong bước hiện tại. Dừng lượt AI để lưu ngay.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Xem hàng chờ',
  uwActSaveAgain: 'Lưu lại',
  uwActStopAi: 'Dừng AI',
  uwActBack: 'Quay lại',
  uwQueuePopWaiting: 'Bản đang chờ lưu: lúc {time} (dựa trên phiên bản {base})',
  uwQueuePopNewer: 'Có thay đổi mới sau đó — chưa gửi',
  uwQueueBlockedSave: 'Lần lưu trước vẫn đang chờ. Bạn lưu tiếp được khi lần đó xong.',
  uwQueueFull:
    'Bộ nhớ đồng bộ trên máy này đã đầy nên lần lưu chưa được xếp hàng. Thay đổi vẫn trong cửa sổ đang mở; hãy giải phóng chỗ trong trung tâm đồng bộ.',
  uwQueueOpenCenter: 'Mở trung tâm đồng bộ',
  uwQueueCancel: 'Hủy lần lưu…',
  uwQueueCancelConfirm:
    'Hủy lần lưu đang chờ? Thay đổi vẫn ở trên máy này; tài liệu trên UniWork không đổi.',
  uwQueueCancelGo: 'Hủy lần lưu',
  uwQueueCancelled: 'Đã hủy lần lưu đang chờ. Thay đổi vẫn ở trên máy này.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'cần đăng nhập lại',
  uwReasonSignedOut: 'đã đăng xuất',
  uwReasonForeign: 'thuộc tài khoản khác',
  uwReasonArchived: 'tài liệu đã được lưu trữ',
  uwReasonSuspended: 'tổ chức đang bị tạm ngưng',
  uwReasonDeactivated: 'tài khoản của bạn đã bị vô hiệu hóa trong tổ chức',
  uwReasonLease: 'quyền offline đã hết hạn',
  uwReasonKeystore: 'kho khóa của máy đang khóa',
  uwReasonClock: 'đồng hồ máy bị lùi',
  uwReasonStoreFull: 'bộ nhớ đồng bộ trên máy đã đầy',
  uwReasonStoreNewer: 'cần phiên bản ứng dụng mới hơn',

  // S2 queue-row badges
  uwBadgeQueued: 'Đang chờ',
  uwBadgeWaitNetwork: 'Chờ mạng',
  uwBadgePausedUser: 'Bạn đã tạm dừng',
  uwBadgePausedAdmin: 'Tạm dừng bởi quản trị',
  uwBadgeSending: 'Đang gửi',
  uwBadgeReconciling: 'Đang đối soát',
  uwBadgeReconcileStuck: 'Cần hỗ trợ',
  uwBadgeConflict: 'Xung đột',
  uwBadgeBlocked: 'Bị chặn',
  uwBadgeLocked: 'Đã khóa',
  uwBadgeRevoked: 'Không còn quyền',
  uwBadgeDeleted: 'Đã xóa',
  uwBadgeReconnect: 'Cần kết nối lại',
  uwBadgeKeystore: 'Kho khóa đang khóa',
  uwBadgeFailed: 'Không gửi được',
  uwBadgeSaved: 'Đã lưu',
  uwBadgeKeptDraft: 'Nháp đã giữ',
  uwBadgeMoved: 'Đã chuyển',
  uwBadgeArchived: 'Đã lưu trữ',

  // S2 queue-row details
  uwRowQueued: 'Lưu lúc {time} · dựa trên phiên bản {base} · {size}',
  uwRowWaitNetwork: 'Sẽ gửi khi có mạng',
  uwRowPausedUser: 'Sẽ gửi khi bạn bấm "Tiếp tục gửi"',
  uwRowPausedAdmin: 'Sẽ gửi khi quản trị viên bật lại',
  uwRowUploading: 'Đang tải lên {done} / {total}',
  uwRowCommitting: 'Đang ghi phiên bản',
  uwRowReconciling: 'Chưa rõ kết quả lần gửi lúc {time}. Đang hỏi lại UniWork.',
  uwRowReconcileStuck:
    'Số lần đã thử đối soát: {count}, chưa có kết quả. Ứng dụng sẽ không gửi lại; hãy gửi mã hỗ trợ cho quản trị viên.',
  uwStuckDiscardConfirm:
    'Bỏ lần lưu này? Nếu nó đã tới UniWork thì phiên bản đó vẫn còn; bản của bạn được giữ thành nháp trong trung tâm đồng bộ.',
  uwRowConflict: 'Phiên bản {n} đã được lưu bởi {author} lúc {time}',
  uwRowFailed: 'Không gửi được: {reason}',
  uwRowBlocked: 'Không lưu được: {reason}',
  uwRowCommitted: 'Phiên bản {n} · {time}',
  uwRowKeptDraft: 'Giữ từ lần tải lại lúc {time}',
  uwRowMoved: 'Tài liệu đã được chuyển tới {workspace}',
  uwRowArchived: 'Tài liệu đã được lưu trữ trên UniWork',

  // S2 row actions
  uwActDiscard: 'Bỏ',
  uwActDiscardSave: 'Bỏ lần lưu…',
  uwActSendNow: 'Gửi ngay',
  uwActRecheck: 'Kiểm tra lại',
  uwActGuide: 'Hướng dẫn',
  uwActOpenToResolve: 'Mở để xử lý',
  uwActCopySupport: 'Sao chép mã hỗ trợ',
  uwActDownloadMine: 'Tải bản của tôi về máy',
  uwActOpenDraft: 'Mở nháp',
  uwActDiscardDraft: 'Bỏ nháp…',
  uwActSignInAgain: 'Đăng nhập lại',
  uwActSignIn: 'Đăng nhập',
  uwActSwitchAccount: 'Chuyển tài khoản',
  uwActReconnect: 'Kết nối lại',
  uwActDetails: 'Chi tiết',
  uwActOpen: 'Mở',
  uwDiscardDraftConfirm:
    'Bỏ nháp này? Thay đổi trong nháp sẽ bị xóa khỏi máy này và không khôi phục được.',

  // Sign-out prompt
  uwSignOutTitle: 'Đăng xuất khỏi UniWork?',
  uwSignOutBody:
    'Tài liệu còn thay đổi chưa lưu hoặc lần lưu đang chờ: {count}. Chúng được giữ khóa trên máy này và chỉ tài khoản của bạn mở lại được.',
  uwSignOutKeystore:
    'Kho khóa của máy đang khóa nên thay đổi chưa lưu chỉ còn trong cửa sổ đang mở. Đăng xuất bây giờ sẽ bỏ các thay đổi đó; những gì đã được giữ mã hóa vẫn còn. Muốn giữ chúng, hãy mở khóa máy trước.',
  uwSignOutGo: 'Đăng xuất',
  uwSignOutWaiting: 'Đang hoàn tất lần lưu đang gửi trước khi đăng xuất…',
  uwSignOutCaptureFailed:
    'Một số thay đổi chưa lưu kịp; bản lưu hoặc tự lưu gần nhất được giữ cho tài khoản của bạn.',
  uwSwitchLostTitle: 'Một số thay đổi chưa lưu của tài khoản trước đã mất',
  uwSwitchLostBody:
    'Một tài khoản khác đã đăng nhập trên máy này nên tài khoản trước đã được khóa. Tài liệu có thay đổi chưa lưu không giữ lại được: {count}. Mọi thứ khác vẫn được giữ khóa trên máy này cho tài khoản đó.',
  uwSwitchLostOk: 'Đã hiểu',

  // S2 sync center
  uwSyncTitle: 'Trung tâm đồng bộ',
  uwSyncOpenFromSettings: 'Trung tâm đồng bộ',
  uwSyncOnline: 'Đã kết nối UniWork · đồng bộ lúc {time}',
  uwSyncOffline: 'Không có mạng · lần đồng bộ cuối {time}',
  uwSyncOnlineNoTime: 'Đã kết nối UniWork',
  uwSyncOfflineNoTime: 'Không có mạng',
  uwSyncPaused: 'Đã tạm dừng gửi — lần lưu mới sẽ chờ',
  uwSyncAdminPaused: 'Quản trị viên đang tạm dừng việc gửi. Các lần lưu được giữ trên máy này.',
  uwSyncFeedOff:
    'Tạm thời không nhận thông báo phiên bản mới. Khi bạn lưu, UniWork vẫn kiểm tra xung đột.',
  uwSyncResynced: 'Đã đồng bộ lại toàn bộ lúc {time}',
  uwSyncResyncFailed:
    'Chưa đồng bộ lại được sau nhiều lần thử. Thông báo phiên bản mới tạm dừng; khi bạn lưu, UniWork vẫn kiểm tra xung đột.',
  uwSyncSignedOut: 'Bạn đã đăng xuất. Số mục đang được giữ khóa trên máy này: {count}.',
  uwSyncSignedOutEmpty: 'Bạn đã đăng xuất.',
  uwSyncSessionExpired: 'Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục gửi.',
  uwSyncOtherOrg: 'Lần lưu đang chờ ở tổ chức khác: {count}',
  uwSyncStoreBudget: 'Bộ nhớ đồng bộ trên máy: {used} / {cap}',
  uwSyncStoreError: 'Không đọc được hàng chờ trên máy này. Dữ liệu chưa bị xóa.',
  uwSyncNow: 'Đồng bộ ngay',
  uwSyncPause: 'Tạm dừng gửi',
  uwSyncResume: 'Tiếp tục gửi',
  uwSyncNowOffline: 'Cần có mạng để đồng bộ.',
  uwSyncTabAttention: 'Cần xử lý',
  uwSyncTabQueue: 'Đang chờ lưu',
  uwSyncTabOffline: 'Dùng khi không có mạng',
  uwSyncTabRecent: 'Đã lưu gần đây',
  uwSyncTabCount: '{label}, {count} mục',
  uwSyncColDoc: 'Tài liệu',
  uwSyncColState: 'Trạng thái',
  uwSyncColDetail: 'Chi tiết',
  uwSyncColActions: 'Hành động',
  uwSyncMoreActions: 'Thêm hành động cho {doc}',
  uwSyncEmptyQueue: 'Không có lần lưu nào đang chờ.',
  uwSyncEmptyAttention: 'Không có gì cần xử lý.',
  uwSyncEmptyRecent: 'Chưa có lần lưu nào gần đây.',
  uwSyncActionFailed: 'Chưa thực hiện được. Không có gì bị xóa; hãy thử lại.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Dùng khi không có mạng',
  uwOfflineUnpin: 'Bỏ dùng khi không có mạng',
  uwOfflineUnpinShort: 'Bỏ ghim',
  uwOfflineAdd: 'Thêm tài liệu…',
  uwOfflineUsage: 'Đang dùng {used} / {cap} trên máy này',
  uwOfflineEmpty: 'Chưa có tài liệu nào dùng khi không có mạng.',
  uwOfflineCapReached:
    'Thư viện offline trên máy này đã đạt giới hạn: dung lượng {cap}; số tài liệu tối đa: {maxDocs}. Bỏ ghim một tài liệu để thêm tài liệu khác.',
  uwOfflineReady: 'Sẵn sàng offline',
  uwOfflineBadgeWaiting: 'Chờ mạng',
  uwOfflineBadgeDownloading: 'Đang tải',
  uwOfflineBadgeVerifying: 'Đang kiểm tra',
  uwOfflineBadgeUpdate: 'Có bản mới',
  uwOfflineBadgeInterrupted: 'Chưa sẵn sàng',
  uwOfflineBadgeDiskFull: 'Không đủ dung lượng',
  uwOfflineBadgeCorrupt: 'Bản tải về bị lỗi',
  uwOfflineBadgeLeaseSoon: 'Sắp hết quyền offline',
  uwOfflineBadgeViewOnly: 'Sẵn sàng offline · chỉ xem',
  uwOfflineRowWaiting: 'Sẽ tải khi có mạng',
  uwOfflineRowProgress: '{done} / {total}',
  uwOfflineRowProgressAria: '{done} trên {total}',
  uwOfflineRowVerifying: 'Đang kiểm tra tính toàn vẹn',
  uwOfflineRowReady: 'Phiên bản {n} · {size} · quyền offline tới {datetime}',
  uwOfflineRowUpdate: 'Phiên bản {n} sẽ tải khi có mạng; bản {old} vẫn dùng được',
  uwOfflineRowUpdateKept:
    'Chưa cập nhật được lên phiên bản {n}: {reason}. Bản {old} vẫn dùng được.',
  uwOfflineRowInterrupted: 'Tải bị gián đoạn. Bản cũ (nếu có) vẫn dùng được.',
  uwOfflineRowDiskFull: 'Cần thêm {size}. Bản cũ vẫn được giữ.',
  uwOfflineRowCorrupt: 'Đã bỏ bản lỗi. Hãy tải lại.',
  uwOfflineRowLeaseSoon: 'Kết nối trước {datetime} để gia hạn',
  uwOfflineRowRevoked:
    'Bạn không còn quyền với tài liệu này. Bản tải về đã được xóa khỏi máy; nháp được giữ khóa.',
  uwOfflineRowDeleted:
    'Tài liệu đã bị xóa trên UniWork. Bản tải về đã được xóa khỏi máy; nháp được giữ khóa.',
  uwOfflineRowArchived: 'Tài liệu đã được lưu trữ; bản trên máy vẫn mở được tới hết quyền offline.',
  uwOfflineRowMoved: 'Đã chuyển tới {workspace}; bản trên máy vẫn dùng được.',
  uwOfflineRowViewOnly: 'Phiên bản {n} · chỉ xem · quyền offline tới {datetime}',
  uwOfflineReadyAnnounce: 'Sẵn sàng offline: {doc}',
  uwOfflineUnpinConfirm:
    'Bản tải về sẽ được xóa khỏi máy này. Nháp và lần lưu đang chờ được giữ lại.',
  uwOfflineCancelDownload: 'Hủy tải',
  uwOfflineDownloadNow: 'Tải ngay',
  uwOfflineOpenFolder: 'Mở thư mục lưu trữ',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Cần kết nối lại',
  uwLockKeystoreTitle: 'Kho khóa của máy đang khóa',
  uwLockClockTitle: 'Cần kiểm tra thời gian',
  uwLockRevokedTitle: 'Không còn quyền truy cập',
  uwLockDeletedTitle: 'Tài liệu đã bị xóa',
  uwLockForeignTitle: 'Tài liệu của tài khoản khác',
  uwLockOrgTitle: 'Không mở được trong tổ chức này',
  uwLockExpired: 'Quyền offline đã hết hạn. Nội dung được giữ mã hóa; kết nối để mở lại.',
  uwLockLibraryOff:
    'Quản trị viên đã tắt tài liệu dùng khi không có mạng nên quyền offline không được gia hạn. Nháp được giữ khóa trong trung tâm đồng bộ.',
  uwLockKeystore:
    'Kho khóa của máy đang khóa nên không mở được nội dung đã mã hóa. Mở khóa máy rồi thử lại; dữ liệu không bị xóa.',
  uwLockClock:
    'Đồng hồ máy đã bị lùi nên quyền offline tạm khóa. Kết nối để UniWork kiểm tra thời gian.',
  uwLockForeign:
    'Tài liệu này thuộc một tài khoản khác trên máy này. Chuyển sang tài khoản đó để mở.',
  uwLockSuspended:
    'Tổ chức đang bị tạm ngưng. Nội dung được giữ mã hóa; hãy liên hệ quản trị viên.',
  uwLockDeactivated:
    'Tài khoản của bạn đã bị vô hiệu hóa trong tổ chức này. Nội dung được giữ mã hóa; hãy liên hệ quản trị viên.',
  uwLockSignedOutTitle: 'Bạn đã đăng xuất',
  uwLockSignedOut: 'Nội dung được giữ khóa trên máy này. Đăng nhập cùng tài khoản để mở lại.',
  uwLockRegion: 'Trạng thái tài liệu',
  uwLockWhileOpen:
    'Tài liệu đã bị khóa trong khi đang mở. Thay đổi chưa lưu được giữ mã hóa; bạn chưa lưu hoặc chép được cho tới khi mở khóa.',
  uwLockWhileOpenRam:
    'Tài liệu đã bị khóa trong khi đang mở và máy chưa giữ được thay đổi một cách an toàn. Thay đổi chỉ còn trong cửa sổ này (chỉ xem); đóng cửa sổ sẽ mất chúng.',
  uwLockOtherWindow: 'Tài liệu này đang mở để sửa trong cửa sổ khác. Cửa sổ này chỉ xem.',
  uwLockOtherWindowGone:
    'Cửa sổ đang sửa tài liệu này không còn phản hồi. Bạn có thể sửa ở cửa sổ này.',
  uwLockGoToWindow: 'Chuyển tới cửa sổ đó',
  uwLockTakeEdit: 'Sửa ở cửa sổ này',

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
    'Đã lưu bản của bạn thành tài liệu mới: {title}. Tài liệu này chưa đổi; bạn vẫn chọn được Tải lại bản mới nhất hoặc Ghi đè.',
  uwConflictSaveCopyFailed: 'Chưa tạo được bản sao. Thay đổi của bạn vẫn an toàn; hãy thử lại.',
  uwConflictSaveCopyNoSeat:
    'Không tạo được bản sao vì bạn không phải thành viên của không gian làm việc chứa tài liệu này. Thay đổi của bạn vẫn an toàn; bạn có thể tải bản của mình về máy.',
  uwConflictSaveCopyFolderRefused:
    'Bạn không thể tạo tài liệu trong thư mục này. Hãy tải bản của bạn về.',
  uwConflictDownloadDone:
    'Đã lưu bản của bạn vào máy: {file}. Tài liệu này chưa đổi; bạn vẫn chọn được Tải lại bản mới nhất hoặc Ghi đè.',
  uwConflictDownloadFailedDesktop: 'Chưa lưu được tệp. Thay đổi của bạn vẫn an toàn; hãy thử lại.',
  uwConflictSaveCopyOffline:
    'Không có mạng. Tạo bản sao cần kết nối; thay đổi của bạn vẫn được giữ.',
  uwConflictReloadFailed:
    'Không tải được bản mới nhất. Tài liệu của bạn chưa thay đổi; hãy thử lại.',
  uwConflictOverwriteFailed: 'Chưa ghi đè được. Tài liệu của bạn chưa thay đổi; hãy thử lại.',
  uwConflictClose: 'Đóng',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Tài liệu này đã được thay đổi ở nơi khác',
  uwConflictBody: 'Thay đổi của bạn chưa lưu lên UniWork và vẫn an toàn trên máy này.',
  uwConflictReload: 'Tải lại bản mới nhất',
  uwConflictOverwrite: 'Ghi đè…',
  uwConflictCancel: 'Hủy',
  uwConflictKeepUnavailable: 'Máy chưa giữ được nháp (bộ nhớ đồng bộ đầy hoặc kho khóa đang khóa).',
  uwConflictOfflineDesktop:
    'Không có mạng và bản mới nhất chưa có trên máy này nên chưa tải lại được.',
  uwConflictReloadDesktopBody: 'Chọn điều xảy ra với thay đổi của bạn trước khi tải phiên bản {n}.',
  uwConflictKeepDraft: 'Giữ bản của tôi làm nháp',
  uwConflictDiscard: 'Bỏ thay đổi của tôi',
  uwConflictKeepDraftHint:
    'Nháp nằm trong trung tâm đồng bộ, mở để xem hoặc chép; không tự áp lên bản mới.',
  uwConflictDraftCapReached:
    'Số nháp được giữ của tài liệu này đã đạt mức tối đa: {cap}. Bỏ một nháp cũ trong trung tâm đồng bộ để giữ thêm.',

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
  uwRemoteWaitCommit: 'Đang chờ lần lưu đang gửi hoàn tất; có thể tiếp tục sau đó.',
  uwRemoteReload: 'Tải lại bản mới nhất…',
  uwRemoteLater: 'Để sau',
  uwRemoteClose: 'Đóng',
  uwRemoteReloadFailed: 'Không tải được phiên bản {n}. Bạn vẫn đang xem bản trước.',
  uwRemoteDeleted: 'Tài liệu này đã bị xóa trên UniWork. Các lần lưu đang chờ đã dừng.',
  uwAuthorFallback: 'một thành viên',

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'Lần lưu trước đang cần hỗ trợ nên chưa tải lại hay ghi đè được. Mở trung tâm đồng bộ để xử lý.',
  uwRemoteRevoked:
    'Bạn không còn quyền truy cập tài liệu này. Đã dừng lưu; thay đổi chưa lưu được giữ khóa trên máy này.',
} satisfies Record<keyof typeof zh, string>
