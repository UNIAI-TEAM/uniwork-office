import type { zh } from './zh'

export const vi = {
  algMenu: 'Nhật ký truy cập',
  algTitle: 'Nhật ký truy cập',
  algDescription: 'Ai đã xem, tải hoặc mở tài liệu qua liên kết. Chỉ người quản lý thấy được.',
  algManageOnly: 'Bạn cần quyền quản lý để xem nhật ký truy cập.',
  algLoading: 'Đang tải nhật ký…',
  algError: 'Không tải được nhật ký truy cập.',
  algEmpty: 'Chưa có lượt truy cập nào.',
  algFilterLabel: 'Hành động',
  algFilterAll: 'Tất cả hành động',
  algActionView: 'Xem',
  algActionDownload: 'Tải về',
  algActionExport: 'Xuất',
  algActionLinkView: 'Mở qua liên kết',
  algActionUnknown: 'Khác',
  algActorAnonymous: 'Ẩn danh',
  algActorSystem: 'Hệ thống',
  algActorUnknown: 'Không rõ',
  algVersion: 'phiên bản {no}',
} satisfies Record<keyof typeof zh, string>
