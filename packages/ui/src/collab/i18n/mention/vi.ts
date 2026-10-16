import type { zh } from './zh'

export const vi = {
  collabMentionLabel: 'Nhắc đến ai đó',
  collabMentionSearching: 'Đang tìm…',
  collabMentionCount: 'Kết quả: {count}',
  collabMentionNoMatch: 'Không có ai khớp “{query}” trong số người xem được tài liệu này.',
  collabMentionNoCandidates: 'Chưa có ai khác xem được tài liệu này.',
  collabMentionError: 'Không tải được danh sách người.',
  collabMentionNoAccessBadge: 'Chưa xem được',
} satisfies Record<keyof typeof zh, string>
