import type { zh } from './zh'

export const ja = {
  convertToWordPreparing: 'Word に変換中：準備中…',
  convertToWordRunning: 'Word に変換中：{page} / {total} ページ',
  convertToExcelPreparing: 'Excel に変換中：準備中…',
  convertToExcelRunning: 'Excel に変換中：{page} / {total} ページ',
  convertToPptPreparing: 'PowerPoint に変換中：準備中…',
  convertToPptRunning: 'PowerPoint に変換中：{page} / {total} ページ',
} satisfies Record<keyof typeof zh, string>
