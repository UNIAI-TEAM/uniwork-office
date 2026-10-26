import type { zh } from './zh'

export const ru = {
  convertToWordPreparing: 'Конвертация в Word… Подготовка…',
  convertToWordRunning: 'Конвертация в Word… страница {page} / {total}',
  convertToExcelPreparing: 'Конвертация в Excel… Подготовка…',
  convertToExcelRunning: 'Конвертация в Excel… страница {page} / {total}',
  convertToPptPreparing: 'Конвертация в PowerPoint… Подготовка…',
  convertToPptRunning: 'Конвертация в PowerPoint… страница {page} / {total}',
} satisfies Record<keyof typeof zh, string>
