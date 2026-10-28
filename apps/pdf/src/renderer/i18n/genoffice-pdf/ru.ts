import type { zh } from './zh'

export const ru = {
  searchMatchCase: 'Учитывать регистр',
  searchWholeWord: 'Слово целиком',
} satisfies Record<keyof typeof zh, string>
