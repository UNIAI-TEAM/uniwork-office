import type { zh } from './zh'

export const ms = {
  searchMatchCase: 'Padankan huruf besar/kecil',
  searchWholeWord: 'Seluruh perkataan',
  commentsPanel: 'Komen',
  commentsFilter: 'Tapis komen mengikut teks atau pengarang',
  commentsEmpty: 'Belum ada komen dalam dokumen ini',
  commentsLoading: 'Memuatkan komen',
  editLink: 'Pautan',
  editLinkHint: 'Seret kotak pada halaman untuk menambah pautan',
  linkDialogTitle: 'Tambah Pautan',
  linkUrlLabel: 'Alamat web',
  linkPageLabel: 'Atau halaman dalam dokumen ini (1–{n})',
} satisfies Record<keyof typeof zh, string>
