import type { zh } from './zh'

export const id = {
  convertToWordPreparing: 'Mengonversi ke Word… Menyiapkan…',
  convertToWordRunning: 'Mengonversi ke Word… halaman {page} / {total}',
  convertToExcelPreparing: 'Mengonversi ke Excel… Menyiapkan…',
  convertToExcelRunning: 'Mengonversi ke Excel… halaman {page} / {total}',
  convertToPptPreparing: 'Mengonversi ke PowerPoint… Menyiapkan…',
  convertToPptRunning: 'Mengonversi ke PowerPoint… halaman {page} / {total}',
} satisfies Record<keyof typeof zh, string>
