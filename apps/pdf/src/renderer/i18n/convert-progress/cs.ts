import type { zh } from './zh'

export const cs = {
  convertToWordPreparing: 'Převod do Wordu… Příprava…',
  convertToWordRunning: 'Převod do Wordu… stránka {page} / {total}',
  convertToExcelPreparing: 'Převod do Excelu… Příprava…',
  convertToExcelRunning: 'Převod do Excelu… stránka {page} / {total}',
  convertToPptPreparing: 'Převod do PowerPointu… Příprava…',
  convertToPptRunning: 'Převod do PowerPointu… stránka {page} / {total}',
} satisfies Record<keyof typeof zh, string>
