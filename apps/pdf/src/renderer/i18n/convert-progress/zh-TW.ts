import type { zh } from './zh'

export const zhTW = {
  convertToWordPreparing: '正在轉換為 Word：準備中…',
  convertToWordRunning: '正在轉換為 Word：第 {page} / {total} 頁',
  convertToExcelPreparing: '正在轉換為 Excel：準備中…',
  convertToExcelRunning: '正在轉換為 Excel：第 {page} / {total} 頁',
  convertToPptPreparing: '正在轉換為 PowerPoint：準備中…',
  convertToPptRunning: '正在轉換為 PowerPoint：第 {page} / {total} 頁',
} satisfies Record<keyof typeof zh, string>
