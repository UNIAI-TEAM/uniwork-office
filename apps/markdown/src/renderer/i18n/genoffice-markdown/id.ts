import type { zh } from './zh'

export const id = {
  backlinks: 'Tautan balik',
  backlinksEmpty: 'Belum ada catatan yang menaut ke sini.',
  backlinksRefresh: 'Segarkan tautan balik',
  graph: 'Tampilan graf',
  graphClose: 'Tutup graf',
  graphEmpty: 'Vault belum memiliki catatan.',
  graphTruncated: 'Terlalu banyak catatan: graf menampilkan {shown} pertama dari {total}.',
  suggestCreateNote: 'Buat catatan baru',
  tags: 'Tag',
  tagsEmpty: 'Belum ada #tag di vault',
} satisfies Record<keyof typeof zh, string>
