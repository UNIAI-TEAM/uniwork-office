import type { zh } from './zh'

export const zhTW = {
  searchMatchCase: '區分大小寫',
  searchWholeWord: '完整字詞',
} satisfies Record<keyof typeof zh, string>
