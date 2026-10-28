import type { zh } from './zh'

export const hi = {
  insertFootnote: 'फ़ुटनोट',
  statusWords: '{n} शब्द',
  statusChars: '{n} अक्षर',
  highlight: 'हाइलाइट',
} satisfies Record<keyof typeof zh, string>
