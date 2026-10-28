import type { zh } from './zh'

export const vi = {
  searchMatchCase: 'Phân biệt chữ hoa chữ thường',
  searchWholeWord: 'Toàn bộ từ',
  commentsPanel: 'Bình luận',
  commentsFilter: 'Lọc bình luận theo nội dung hoặc tác giả',
  commentsEmpty: 'Tài liệu này chưa có bình luận',
  commentsLoading: 'Đang tải bình luận',
  editLink: 'Liên kết',
  editLinkHint: 'Kéo một khung trên trang để thêm siêu liên kết',
  linkDialogTitle: 'Thêm liên kết',
  linkUrlLabel: 'Địa chỉ web',
  linkPageLabel: 'Hoặc một trang trong tài liệu (1–{n})',
} satisfies Record<keyof typeof zh, string>
