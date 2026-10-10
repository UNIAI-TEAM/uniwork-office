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
  webViewOnlyNotSaved: 'Dokumen ini hanya dapat dilihat dan tidak dapat disimpan',
  webNotUtf8:
    'File ini bukan teks UTF-8. File dibuka hanya-lihat agar penyimpanan tidak mengubah isinya',
  webDraftTitle: 'Pulihkan perubahan yang belum disimpan?',
  webDraftBody:
    'Browser ini menyimpan salinan perubahan pada dokumen ini yang belum disimpan. Pulihkan atau buang?',
  webDraftOlder:
    'Salinan ini berdasarkan versi dokumen yang lebih lama. Menyimpannya akan menggantikan versi yang lebih baru.',
  webDraftSavedAt: 'Salinan disimpan pukul',
  webDraftKept: 'Peramban ini menyimpan salinan sampai Anda keluar.',
  webDraftRestore: 'Pulihkan',
  webDraftDiscard: 'Buang',
  webSaveNetwork: 'UniWork tidak dapat dijangkau. Periksa koneksi Anda lalu coba lagi.',
  webSaveTimeout: 'Penyimpanan memakan waktu terlalu lama. Periksa koneksi Anda lalu coba lagi.',
  webClose: 'Tutup',
  webSaveUnauthorized: 'Sesi UniWork Anda berakhir. Masuk lagi, lalu coba simpan kembali.',
  webSaveForbidden: 'Anda tidak memiliki izin untuk menyimpan dokumen ini.',
  webSaveNotFound: 'Dokumen ini sudah tidak ada atau telah dipindahkan.',
  webSaveTooLarge: 'Dokumen terlalu besar untuk disimpan.',
  webSaveRateLimited: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  webSaveServer: 'UniWork mengalami masalah saat menyimpan. Coba lagi sebentar lagi.',
  webSaveFailedGeneric: 'Dokumen tidak dapat disimpan. Coba lagi.',
} satisfies Record<keyof typeof zh, string>
