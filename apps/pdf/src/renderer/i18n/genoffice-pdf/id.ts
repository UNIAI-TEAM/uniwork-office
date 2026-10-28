import type { zh } from './zh'

export const id = {
  searchMatchCase: 'Cocokkan huruf besar/kecil',
  searchWholeWord: 'Seluruh kata',
} satisfies Record<keyof typeof zh, string>
