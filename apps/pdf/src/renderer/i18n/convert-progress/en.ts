import type { zh } from './zh'

export const en = {
  convertToWordPreparing: 'Converting to Word: preparing…',
  convertToWordRunning: 'Converting to Word… page {page} / {total}',
  convertToExcelPreparing: 'Converting to Excel: preparing…',
  convertToExcelRunning: 'Converting to Excel… page {page} / {total}',
  convertToPptPreparing: 'Converting to PowerPoint: preparing…',
  convertToPptRunning: 'Converting to PowerPoint… page {page} / {total}',
} satisfies Record<keyof typeof zh, string>
