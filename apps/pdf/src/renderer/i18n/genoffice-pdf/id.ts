import type { zh } from './zh'

export const id = {
  searchMatchCase: 'Cocokkan huruf besar/kecil',
  searchWholeWord: 'Seluruh kata',
  commentsPanel: 'Komentar',
  commentsFilter: 'Saring komentar berdasarkan teks atau penulis',
  commentsEmpty: 'Belum ada komentar dalam dokumen ini',
  commentsLoading: 'Memuat komentar',
} satisfies Record<keyof typeof zh, string>
