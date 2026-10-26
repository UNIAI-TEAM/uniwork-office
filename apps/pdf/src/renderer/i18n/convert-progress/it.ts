import type { zh } from './zh'

export const it = {
  convertToWordPreparing: 'Conversione in Word… Preparazione…',
  convertToWordRunning: 'Conversione in Word… pagina {page} / {total}',
  convertToExcelPreparing: 'Conversione in Excel… Preparazione…',
  convertToExcelRunning: 'Conversione in Excel… pagina {page} / {total}',
  convertToPptPreparing: 'Conversione in PowerPoint… Preparazione…',
  convertToPptRunning: 'Conversione in PowerPoint… pagina {page} / {total}',
} satisfies Record<keyof typeof zh, string>
