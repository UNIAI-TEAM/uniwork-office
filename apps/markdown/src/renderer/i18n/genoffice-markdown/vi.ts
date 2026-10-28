import type { zh } from './zh'

export const vi = {
  backlinks: 'Liên kết ngược',
  backlinksEmpty: 'Chưa có ghi chú nào liên kết đến đây.',
  backlinksRefresh: 'Làm mới liên kết ngược',
  graph: 'Xem đồ thị',
  graphClose: 'Đóng đồ thị',
  graphEmpty: 'Kho chưa có ghi chú nào.',
  graphTruncated:
    'Quá nhiều ghi chú: biểu đồ chỉ hiển thị {shown} ghi chú đầu tiên trong tổng số {total}.',
  suggestCreateNote: 'Tạo ghi chú mới',
  tags: 'Thẻ',
  tagsEmpty: 'Chưa có #thẻ nào trong kho',
} satisfies Record<keyof typeof zh, string>
