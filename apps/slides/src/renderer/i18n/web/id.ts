import type { zh } from './zh'

export const id = {
  webConflictTitle: 'Presentasi ini diubah di tempat lain',
  webConflictBody:
    'Perubahan Anda belum ada di UniWork dan disimpan di browser ini sampai Anda keluar.',
  webConflictOverwrite: 'Timpa…',
  webConflictReload: 'Muat ulang terbaru',
  webConflictNotSaved: 'presentasi diubah di tempat lain',
  webDiscardTitle: 'Buang perubahan yang belum disimpan?',
  webDiscardBody:
    'Presentasi ini memiliki perubahan yang belum disimpan. Membuka file lain akan menghilangkannya.',
  webDiscard: 'Buang dan buka',
  webCancel: 'Batal',
  webOk: 'OK',
  webFatalTitle: 'Presentasi tidak dapat dibuka',
  webFatalBody: 'File tidak dapat dimuat dari UniWork. Tutup tab ini dan coba lagi.',
  webRefusedTooLarge: 'Presentasi ini terlalu besar atau terlalu kompleks untuk dibuka di web.',
  webRefusedTooComplex:
    'Presentasi ini terlalu kompleks untuk dibuka di web ({parts} bagian, batas {limit}).',
  webRefusedOutOfMemory: 'Presentasi ini terlalu besar dan kehabisan memori browser saat dibuka.',
  webNoHost: 'Editor ini berjalan di dalam UniWork. Buka presentasi dari UniWork.',
  webLegacyPpt:
    'Ini adalah file .ppt lama dan tidak dapat dibuka di browser. Simpan sebagai .pptx di PowerPoint terlebih dahulu.',
  webEncryptedPptx: 'Presentasi ini dilindungi kata sandi dan tidak dapat dibuka di browser.',
  webCommentAuthor: 'Pengguna',
  webExternalMedia: 'Media eksternal yang ditautkan hanya diputar di aplikasi desktop.',
  webReadOnly: 'Presentasi ini hanya-baca.',
  webSaveNetwork: 'UniWork tidak dapat dijangkau. Periksa koneksi Anda lalu coba lagi.',
  webSaveTimeout: 'Penyimpanan memakan waktu terlalu lama. Periksa koneksi Anda lalu coba lagi.',
  webFullscreenHint: 'Klik atau tekan tombol apa saja untuk masuk ke layar penuh',
} satisfies Record<keyof typeof zh, string>
