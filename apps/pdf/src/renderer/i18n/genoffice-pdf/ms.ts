import type { zh } from './zh'

export const ms = {
  searchMatchCase: 'Padankan huruf besar/kecil',
  searchWholeWord: 'Seluruh perkataan',
  commentsPanel: 'Komen',
  commentsFilter: 'Tapis komen mengikut teks atau pengarang',
  commentsEmpty: 'Belum ada komen dalam dokumen ini',
  commentsLoading: 'Memuatkan komen',
} satisfies Record<keyof typeof zh, string>
