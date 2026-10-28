import type { zh } from './zh'

export const ms = {
  backlinks: 'Pautan balik',
  backlinksEmpty: 'Belum ada nota yang memautkan ke sini.',
  backlinksRefresh: 'Segar semula pautan balik',
  graph: 'Paparan graf',
  graphClose: 'Tutup graf',
  graphEmpty: 'Vault belum mempunyai nota.',
  graphTruncated: 'Terlalu banyak nota: graf menunjukkan {shown} yang pertama daripada {total}.',
  suggestCreateNote: 'Cipta nota baharu',
  tags: 'Tag',
  tagsEmpty: 'Belum ada #tag dalam vault',
  blockLink: 'Salin pautan ke blok',
  blockLinkCopied: '{link} disalin',
  blockLinkNone: 'Tiada blok untuk dipautkan di sini',
  insertFootnote: 'Nota kaki',
  statusWords: '{n} perkataan',
  statusChars: '{n} aksara',
  highlight: 'Serlahkan',
} satisfies Record<keyof typeof zh, string>
