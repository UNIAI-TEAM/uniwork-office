import type { zh } from './zh'

export const vi = {
  setRestoreSession: 'Mở lại tài liệu của lần trước',
  setRestoreSessionDesc:
    'Các tài liệu đang mở khi đóng UniWork Office sẽ tự động mở lại vào lần khởi động tiếp theo.',
  setAutoUpdateCheck: 'Tự động kiểm tra cập nhật',
  setAutoUpdateCheckDesc:
    'Khi tắt, UniWork Office không còn kiểm tra phiên bản mới khi khởi động hoặc chạy nền. Bạn vẫn có thể kiểm tra trong Trợ giúp › Kiểm tra bản cập nhật.',
} satisfies Record<keyof typeof zh, string>
