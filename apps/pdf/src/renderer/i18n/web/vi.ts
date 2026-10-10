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
  webSaveNetwork: 'Không kết nối được tới UniWork. Hãy kiểm tra mạng rồi thử lại.',
  webSaveTimeout: 'Việc lưu mất quá nhiều thời gian. Hãy kiểm tra mạng rồi thử lại.',
  webAppOnlyHint: 'Mở trong ứng dụng UniWork Office để dùng tính năng này',
  webAppOnlyOpen: 'Mở trong ứng dụng',
  webAppOnlyOcr: 'PDF này có trang quét. Tính năng nhận dạng văn bản (OCR) không có ở đây.',
  webAppOnlyConvert: 'Chuyển PDF sang Word, Excel hoặc PowerPoint không có ở đây.',
} satisfies Record<keyof typeof zh, string>
