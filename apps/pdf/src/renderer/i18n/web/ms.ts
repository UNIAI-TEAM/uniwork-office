import type { zh } from './zh'

export const ms = {
  webCancel: 'Batal',
  webConflictTitle: 'Dokumen ini telah diubah di tempat lain',
  webConflictBody:
    'Versi yang lebih baharu telah disimpan semasa anda menyunting. Tulis ganti dengan versi anda, atau muat semula versi terkini dan buang perubahan anda?',
  webConflictOverwrite: 'Tulis ganti',
  webConflictReload: 'Muat semula versi terkini',
  webConflictNotSaved: 'dokumen telah diubah di tempat lain',
  webFatalTitle: 'Dokumen tidak dapat dibuka',
  webFatalBody:
    'Penyuntingan dan penyimpanan dilumpuhkan. Muat semula halaman atau buka semula dokumen daripada UniWork.',
  webNoHost: 'Editor ini berjalan di dalam UniWork. Buka dokumen daripada UniWork.',
  webViewOnly: 'Lihat sahaja',
  webReloaded: 'versi terkini dimuat semula dan perubahan anda dibuang',
  webViewOnlyNoSave: 'dokumen ini untuk dilihat sahaja',
  webMergeTitle: 'Gabungkan PDF',
  webMergeBody: '{count} PDF dipilih. Tambah PDF lain atau gabungkan sekarang?',
  webMergeAdd: 'Tambah PDF lain',
  webMergeNow: 'Gabungkan sekarang',
  webSaveNetwork: 'UniWork tidak dapat dicapai. Semak sambungan anda dan cuba lagi.',
  webSaveTimeout: 'Penyimpanan mengambil masa terlalu lama. Semak sambungan anda dan cuba lagi.',
  webAppOnlyHint: 'Buka dalam aplikasi UniWork Office untuk menggunakan ciri ini',
  webAppOnlyOpen: 'Buka dalam aplikasi',
  webAppOnlyOcr: 'PDF ini mempunyai halaman imbasan. Pengecaman teks (OCR) tidak tersedia di sini.',
  webAppOnlyConvert: 'Penukaran PDF kepada Word, Excel atau PowerPoint tidak tersedia di sini.',
  webAppOnlyRedact:
    'Penyuntingan sulit (membuang kandungan yang ditanda secara kekal) tidak tersedia di sini.',
} satisfies Record<keyof typeof zh, string>
