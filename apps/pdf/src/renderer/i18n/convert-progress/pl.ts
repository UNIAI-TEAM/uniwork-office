import type { zh } from './zh'

export const pl = {
  convertToWordPreparing: 'Konwertowanie do Word… Przygotowywanie…',
  convertToWordRunning: 'Konwertowanie do Word… strona {page} / {total}',
  convertToExcelPreparing: 'Konwertowanie do Excel… Przygotowywanie…',
  convertToExcelRunning: 'Konwertowanie do Excel… strona {page} / {total}',
  convertToPptPreparing: 'Konwertowanie do PowerPoint… Przygotowywanie…',
  convertToPptRunning: 'Konwertowanie do PowerPoint… strona {page} / {total}',
} satisfies Record<keyof typeof zh, string>
