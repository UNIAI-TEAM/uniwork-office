import type { zh } from './zh'

export const en = {
  insertFootnote: 'Footnote',
  statusWords: '{n} words',
  statusChars: '{n} characters',
  highlight: 'Highlight',
} satisfies Record<keyof typeof zh, string>
