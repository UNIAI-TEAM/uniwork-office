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
  webViewOnlyNotSaved: 'Tài liệu này chỉ xem, không thể lưu',
  webNotUtf8:
    'Tệp này không phải văn bản UTF-8. Tệp được mở ở chế độ chỉ xem để việc lưu không làm thay đổi nội dung',
  webDraftTitle: 'Khôi phục các thay đổi chưa lưu?',
  webDraftBody:
    'Trình duyệt này đã giữ một bản sao các thay đổi chưa lưu của tài liệu này. Khôi phục hay bỏ các thay đổi đó?',
  webDraftOlder:
    'Bản sao dựa trên một phiên bản cũ hơn của tài liệu. Lưu bản sao sẽ thay thế phiên bản mới hơn.',
  webDraftSavedAt: 'Bản sao được giữ lúc',
  webDraftRestore: 'Khôi phục',
  webDraftDiscard: 'Bỏ',
} satisfies Record<keyof typeof zh, string>
