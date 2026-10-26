import type { zh } from './zh'

export const vi = {
  convertToWordPreparing: 'Đang chuyển đổi sang Word: đang chuẩn bị…',
  convertToWordRunning: 'Đang chuyển đổi sang Word… trang {page} / {total}',
  convertToExcelPreparing: 'Đang chuyển đổi sang Excel: đang chuẩn bị…',
  convertToExcelRunning: 'Đang chuyển đổi sang Excel… trang {page} / {total}',
  convertToPptPreparing: 'Đang chuyển đổi sang PowerPoint: đang chuẩn bị…',
  convertToPptRunning: 'Đang chuyển đổi sang PowerPoint… trang {page} / {total}',
} satisfies Record<keyof typeof zh, string>
