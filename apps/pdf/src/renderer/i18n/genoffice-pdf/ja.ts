import type { zh } from './zh'

export const ja = {
  searchMatchCase: '大文字と小文字を区別',
  searchWholeWord: '単語全体',
} satisfies Record<keyof typeof zh, string>
