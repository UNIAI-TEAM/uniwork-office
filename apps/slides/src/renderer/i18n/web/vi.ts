import type { zh } from './zh'

export const vi = {
  webConflictTitle: 'Bản trình bày này đã được thay đổi ở nơi khác',
  webConflictBody:
    'Ai đó đã lưu một phiên bản mới hơn. Ghi đè sẽ thay thế bằng thay đổi của bạn; Tải lại bản mới nhất sẽ bỏ thay đổi của bạn và mở phiên bản mới nhất.',
  webConflictOverwrite: 'Ghi đè',
  webConflictReload: 'Tải lại bản mới nhất',
  webConflictNotSaved: 'bản trình bày đã được thay đổi ở nơi khác',
  webDiscardTitle: 'Bỏ các thay đổi chưa lưu?',
  webDiscardBody: 'Bản trình bày này có thay đổi chưa lưu. Mở tệp khác sẽ làm mất các thay đổi đó.',
  webDiscard: 'Bỏ và mở',
  webCancel: 'Hủy',
  webOk: 'OK',
  webFatalTitle: 'Không thể mở bản trình bày',
  webFatalBody: 'Không tải được tệp từ UniWork. Hãy đóng thẻ này và thử lại.',
  webNoHost: 'Trình soạn thảo này chạy bên trong UniWork. Hãy mở bản trình bày từ UniWork.',
  webLegacyPpt:
    'Đây là tệp .ppt cũ và không thể mở trong trình duyệt. Hãy lưu thành .pptx trong PowerPoint trước.',
  webEncryptedPptx:
    'Bản trình bày này được bảo vệ bằng mật khẩu và không thể mở trong trình duyệt.',
  webCommentAuthor: 'Người dùng',
  webExternalMedia: 'Phương tiện liên kết bên ngoài chỉ phát được trong ứng dụng máy tính.',
  webReadOnly: 'Bản trình bày này chỉ đọc.',
} satisfies Record<keyof typeof zh, string>
