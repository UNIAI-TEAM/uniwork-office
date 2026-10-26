import type { zh } from './zh'

export const pt = {
  convertToWordPreparing: 'Convertendo para Word… Preparando…',
  convertToWordRunning: 'Convertendo para Word… página {page} / {total}',
  convertToExcelPreparing: 'Convertendo para Excel… Preparando…',
  convertToExcelRunning: 'Convertendo para Excel… página {page} / {total}',
  convertToPptPreparing: 'Convertendo para PowerPoint… Preparando…',
  convertToPptRunning: 'Convertendo para PowerPoint… página {page} / {total}',
} satisfies Record<keyof typeof zh, string>
