import type { zh } from './zh'

export const zhTW = {
  insertFootnote: '腳注',
  statusWords: '{n} 個字',
  statusChars: '{n} 個字元',
} satisfies Record<keyof typeof zh, string>
