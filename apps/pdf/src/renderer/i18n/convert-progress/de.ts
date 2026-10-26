import type { zh } from './zh'

export const de = {
  convertToWordPreparing: 'In Word umwandeln… Vorbereitung…',
  convertToWordRunning: 'In Word umwandeln… Seite {page} / {total}',
  convertToExcelPreparing: 'In Excel umwandeln… Vorbereitung…',
  convertToExcelRunning: 'In Excel umwandeln… Seite {page} / {total}',
  convertToPptPreparing: 'In PowerPoint umwandeln… Vorbereitung…',
  convertToPptRunning: 'In PowerPoint umwandeln… Seite {page} / {total}',
} satisfies Record<keyof typeof zh, string>
