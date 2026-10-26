import type { zh } from './zh'

export const he = {
  convertToWordPreparing: 'ממיר ל-Word… מכין…',
  convertToWordRunning: 'ממיר ל-Word… עמוד {page} / {total}',
  convertToExcelPreparing: 'ממיר ל-Excel… מכין…',
  convertToExcelRunning: 'ממיר ל-Excel… עמוד {page} / {total}',
  convertToPptPreparing: 'ממיר ל-PowerPoint… מכין…',
  convertToPptRunning: 'ממיר ל-PowerPoint… עמוד {page} / {total}',
} satisfies Record<keyof typeof zh, string>
