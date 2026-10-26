import type { zh } from './zh'

export const fr = {
  convertToWordPreparing: 'Conversion en Word… Préparation…',
  convertToWordRunning: 'Conversion en Word… page {page} / {total}',
  convertToExcelPreparing: 'Conversion en Excel… Préparation…',
  convertToExcelRunning: 'Conversion en Excel… page {page} / {total}',
  convertToPptPreparing: 'Conversion en PowerPoint… Préparation…',
  convertToPptRunning: 'Conversion en PowerPoint… page {page} / {total}',
} satisfies Record<keyof typeof zh, string>
