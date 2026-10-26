import type { zh } from './zh'

export const ms = {
  convertToWordPreparing: 'Menukar kepada Word… Sedang menyediakan…',
  convertToWordRunning: 'Menukar kepada Word… halaman {page} / {total}',
  convertToExcelPreparing: 'Menukar kepada Excel… Sedang menyediakan…',
  convertToExcelRunning: 'Menukar kepada Excel… halaman {page} / {total}',
  convertToPptPreparing: 'Menukar kepada PowerPoint… Sedang menyediakan…',
  convertToPptRunning: 'Menukar kepada PowerPoint… halaman {page} / {total}',
} satisfies Record<keyof typeof zh, string>
