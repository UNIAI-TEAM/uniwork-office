import type { zh } from './zh'

export const nl = {
  searchMatchCase: 'Hoofdlettergevoelig',
  searchWholeWord: 'Alleen hele woorden',
} satisfies Record<keyof typeof zh, string>
