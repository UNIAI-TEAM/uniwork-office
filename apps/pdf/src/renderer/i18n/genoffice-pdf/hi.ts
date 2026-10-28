import type { zh } from './zh'

export const hi = {
  searchMatchCase: 'अक्षर-स्थिति मिलाएँ',
  searchWholeWord: 'पूरे शब्द',
} satisfies Record<keyof typeof zh, string>
