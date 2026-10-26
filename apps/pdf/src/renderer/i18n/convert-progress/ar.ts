import type { zh } from './zh'

export const ar = {
  convertToWordPreparing: 'جارٍ التحويل إلى Word… جارٍ التجهيز…',
  convertToWordRunning: 'جارٍ التحويل إلى Word… الصفحة {page} / {total}',
  convertToExcelPreparing: 'جارٍ التحويل إلى Excel… جارٍ التجهيز…',
  convertToExcelRunning: 'جارٍ التحويل إلى Excel… الصفحة {page} / {total}',
  convertToPptPreparing: 'جارٍ التحويل إلى PowerPoint… جارٍ التجهيز…',
  convertToPptRunning: 'جارٍ التحويل إلى PowerPoint… الصفحة {page} / {total}',
} satisfies Record<keyof typeof zh, string>
