import type { zh } from './zh'

export const id = {
  webCancel: 'Batal',
  webConflictTitle: 'Dokumen ini telah diubah di tempat lain',
  webConflictBody:
    'Versi yang lebih baru disimpan saat Anda mengedit. Timpa dengan versi Anda, atau muat ulang versi terbaru dan buang perubahan Anda?',
  webConflictOverwrite: 'Timpa',
  webConflictReload: 'Muat versi terbaru',
  webConflictNotSaved: 'dokumen telah diubah di tempat lain',
  webFatalTitle: 'Dokumen tidak dapat dibuka',
  webFatalBody:
    'Pengeditan dan penyimpanan dinonaktifkan. Muat ulang halaman atau buka kembali dokumen dari UniWork.',
  webNoHost: 'Editor ini berjalan di dalam UniWork. Buka dokumen dari UniWork.',
  webViewOnly: 'Hanya lihat',
  webReloaded: 'versi terbaru dimuat ulang dan perubahan Anda dibuang',
  webViewOnlyNoSave: 'dokumen ini hanya dapat dilihat',
  webMergeTitle: 'Gabungkan PDF',
  webMergeBody: '{count} PDF dipilih. Tambah PDF lain atau gabungkan sekarang?',
  webMergeAdd: 'Tambah PDF lain',
  webMergeNow: 'Gabungkan sekarang',
  webSaveNetwork: 'UniWork tidak dapat dijangkau. Periksa koneksi Anda lalu coba lagi.',
  webSaveTimeout: 'Penyimpanan memakan waktu terlalu lama. Periksa koneksi Anda lalu coba lagi.',
} satisfies Record<keyof typeof zh, string>
