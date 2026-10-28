import type { zh } from './zh'

export const id = {
  searchMatchCase: 'Cocokkan huruf besar/kecil',
  searchWholeWord: 'Seluruh kata',
  commentsPanel: 'Komentar',
  commentsFilter: 'Saring komentar berdasarkan teks atau penulis',
  commentsEmpty: 'Belum ada komentar dalam dokumen ini',
  commentsLoading: 'Memuat komentar',
  editLink: 'Tautan',
  editLinkHint: 'Seret kotak pada halaman untuk menambahkan tautan',
  linkDialogTitle: 'Tambah Tautan',
  linkUrlLabel: 'Alamat web',
  linkPageLabel: 'Atau halaman dalam dokumen ini (1–{n})',
} satisfies Record<keyof typeof zh, string>
