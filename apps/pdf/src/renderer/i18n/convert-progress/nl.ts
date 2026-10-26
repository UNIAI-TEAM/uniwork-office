import type { zh } from './zh'

export const nl = {
  convertToWordPreparing: 'Converteren naar Word… Voorbereiden…',
  convertToWordRunning: 'Converteren naar Word… pagina {page} / {total}',
  convertToExcelPreparing: 'Converteren naar Excel… Voorbereiden…',
  convertToExcelRunning: 'Converteren naar Excel… pagina {page} / {total}',
  convertToPptPreparing: 'Converteren naar PowerPoint… Voorbereiden…',
  convertToPptRunning: 'Converteren naar PowerPoint… pagina {page} / {total}',
} satisfies Record<keyof typeof zh, string>
