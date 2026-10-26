import type { zh } from './zh'

export const th = {
  convertToWordPreparing: 'กำลังแปลงเป็น Word… กำลังเตรียม…',
  convertToWordRunning: 'กำลังแปลงเป็น Word… หน้า {page} / {total}',
  convertToExcelPreparing: 'กำลังแปลงเป็น Excel… กำลังเตรียม…',
  convertToExcelRunning: 'กำลังแปลงเป็น Excel… หน้า {page} / {total}',
  convertToPptPreparing: 'กำลังแปลงเป็น PowerPoint… กำลังเตรียม…',
  convertToPptRunning: 'กำลังแปลงเป็น PowerPoint… หน้า {page} / {total}',
} satisfies Record<keyof typeof zh, string>
