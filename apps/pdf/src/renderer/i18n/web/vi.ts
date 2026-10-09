import type { zh } from './zh'

export const vi = {
  webCancel: 'Hủy',
  webConflictTitle: 'Tài liệu này đã được thay đổi ở nơi khác',
  webConflictBody:
    'Một phiên bản mới hơn đã được lưu trong khi bạn chỉnh sửa. Ghi đè bằng phiên bản của bạn, hay tải lại phiên bản mới nhất và bỏ các thay đổi của bạn?',
  webConflictOverwrite: 'Ghi đè',
  webConflictReload: 'Tải lại bản mới nhất',
  webConflictNotSaved: 'tài liệu đã được thay đổi ở nơi khác',
  webFatalTitle: 'Không thể mở tài liệu',
  webFatalBody: 'Đã tắt chỉnh sửa và lưu. Hãy tải lại trang hoặc mở lại tài liệu từ UniWork.',
  webNoHost: 'Trình soạn thảo này chạy bên trong UniWork. Hãy mở tài liệu từ UniWork.',
  webViewOnly: 'Chỉ xem',
  webReloaded: 'đã tải lại bản mới nhất và bỏ các thay đổi của bạn',
  webViewOnlyNoSave: 'tài liệu này chỉ được xem',
  webMergeTitle: 'Gộp PDF',
  webMergeBody: 'Đã chọn {count} tệp PDF. Thêm PDF khác hay gộp ngay?',
  webMergeAdd: 'Thêm PDF khác',
  webMergeNow: 'Gộp ngay',
} satisfies Record<keyof typeof zh, string>
