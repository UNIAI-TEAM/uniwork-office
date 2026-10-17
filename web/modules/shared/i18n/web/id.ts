import type { zh } from './zh'

export const id = {
  webCancel: 'Batal',
  webConflictTitle: 'Dokumen ini telah diubah di tempat lain',
  webConflictBody:
    'Perubahan Anda belum ada di UniWork dan disimpan di browser ini sampai Anda keluar.',
  webConflictOverwrite: 'Timpa…',
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

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Perubahan Anda belum ada di UniWork dan disimpan di browser ini sampai Anda keluar.',
  uwConflictReloadWebBody:
    'Browser tidak menyimpan draf konflik. Unduh versi Anda untuk disalin nanti, atau buang perubahan Anda.',
  uwConflictDownloadThenReload: 'Unduh versi saya, lalu muat ulang',
  uwConflictDiscardThenReload: 'Buang perubahan dan muat ulang',
  uwConflictMineFileSuffix: '(versi saya)',
  uwConflictDownloadCheck:
    'Browser Anda menerima file Anda. Periksa bahwa file sudah tersimpan, lalu pilih Muat ulang.',
  uwConflictSessionWeb:
    'Sesi Anda kedaluwarsa, jadi penimpaan tidak terjadi. Perubahan Anda tetap di browser ini; masuk lagi lalu coba ulang.',
  uwConflictTooLarge: 'Versi Anda melebihi batas ukuran UniWork, jadi tidak dapat menimpa.',
  uwConflictDownloadTooLarge:
    'Versi Anda melebihi batas ukuran UniWork, jadi tidak dapat diunduh di sini.',
  uwConflictDownloadFailed:
    'Tidak dapat mengunduh versi Anda, jadi dokumen tidak dimuat ulang. Coba lagi.',
  uwConflictOfflineWeb:
    'Anda sedang offline. Di web ini memerlukan koneksi; perubahan Anda tetap di browser ini.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Versi Anda',
  uwConflictColServer: 'Versi di UniWork',
  uwConflictRowVersion: 'Versi',
  uwConflictRowTime: 'Waktu',
  uwConflictRowBy: 'Disimpan oleh',
  uwConflictMineUnsaved: 'Anda (belum disimpan)',
  uwConflictBasedOn: 'berdasarkan versi {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Lihat perbedaan',
  uwConflictDiffPending: 'Membandingkan…',
  uwConflictDiffFailed: 'Versi tidak dapat dibandingkan saat ini. Coba lagi nanti.',
  uwConflictNoEdit: 'Anda tidak lagi memiliki akses edit ke dokumen ini.',
  uwConflictOverwriteTitle: 'Timpa dengan versi Anda?',
  uwConflictOverwriteConfirm:
    'UniWork akan membuat versi {next} dari salinan Anda. Versi {server} oleh {author} tetap ada di riwayat.',
  uwConflictOverwriteGo: 'Timpa',
  uwConflictBack: 'Kembali',
  uwConflictHeadMoved:
    'Sementara itu UniWork mendapat versi {n}. Tabel telah diperbarui; pilih lagi.',
  uwConflictReloadTitle: 'Muat ulang versi terbaru',
  uwConflictReloadGo: 'Muat ulang',
  uwConflictSaveCopy: 'Simpan sebagai salinan…',
  uwConflictSaveCopyName: '{name} (salinan)',
  uwConflictSaveCopyTitle: 'Simpan sebagai salinan?',
  uwConflictSaveCopyConfirm:
    'UniWork akan membuat dokumen baru dari versi Anda, dengan pemilik dan akses yang sama seperti dokumen ini. Dokumen saat ini dan versi {server} oleh {author} tetap seperti semula.',
  uwConflictSaveCopyGo: 'Buat salinan',
  uwConflictSaveCopyDone:
    'Versi Anda disimpan sebagai dokumen baru: {title}. Dokumen ini tidak berubah; Anda masih bisa memuat ulang atau menimpa.',
  uwConflictSaveCopyFailed: 'Tidak dapat membuat salinan. Perubahan Anda tetap aman; coba lagi.',
  uwConflictSaveCopyOffline:
    'Anda sedang offline. Membuat salinan memerlukan koneksi; perubahan Anda tetap disimpan.',
  uwConflictReloadFailed:
    'Tidak dapat memuat versi terbaru. Dokumen Anda tidak berubah; coba lagi.',
  uwConflictOverwriteFailed: 'Belum dapat menimpa. Dokumen Anda tidak berubah; coba lagi.',
  uwConflictClose: 'Tutup',

  // S6 new-version bar
  uwRemoteRegion: 'Versi baru',
  uwRemoteUpdated: 'Diperbarui ke versi {n}, disimpan oleh {author} pada {time}.',
  uwRemoteUpdatedNoRev: 'Diperbarui ke versi terbaru di UniWork.',
  uwRemoteNewerDirty:
    'Ada versi lebih baru di UniWork (versi {n}). Anda punya perubahan yang belum disimpan, jadi dokumen tidak dimuat ulang.',
  uwRemoteNewerAi:
    'Ada versi lebih baru di UniWork (versi {n}). UniWork AI sedang berjalan, jadi dokumen tidak dimuat ulang; hasil AI hanya berlaku untuk salinan yang terbuka.',
  uwRemoteNowClean:
    'Anda telah membatalkan semua perubahan. Versi {n} di UniWork lebih baru daripada salinan yang terbuka.',
  uwRemoteStopAiConfirm:
    'Hentikan proses UniWork AI yang sedang berjalan untuk memuat ulang? Perubahan yang sudah dibuat AI menjadi bagian salinan yang terbuka.',
  uwRemoteWaitCommit:
    'Menunggu penyimpanan yang sedang berjalan selesai; Anda bisa memuat ulang setelahnya.',
  uwRemoteReload: 'Muat ulang versi terbaru…',
  uwRemoteLater: 'Nanti',
  uwRemoteClose: 'Tutup',
  uwRemoteReloadFailed: 'Tidak dapat memuat versi {n}. Anda masih melihat versi sebelumnya.',
  uwRemoteDeleted: 'Dokumen ini dihapus di UniWork. Penyimpanan dalam antrean dihentikan.',
  uwAuthorFallback: 'seorang anggota',
  uwLockRegion: 'Status dokumen',
  uwActRetry: 'Coba lagi',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'Anda tidak lagi memiliki akses ke dokumen ini. Penyimpanan dihentikan; perubahan yang belum disimpan disimpan di browser ini sampai Anda keluar.',
  uwRemoteOrgBlockedWeb:
    'Tidak dapat menyimpan: {reason}. Perubahan yang belum disimpan disimpan di browser ini sampai Anda keluar.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'dokumen diarsipkan',
  uwReasonSuspended: 'organisasi ditangguhkan',
  uwReasonDeactivated: 'akun Anda dinonaktifkan di organisasi ini',

  webSizeWarnChip: 'Mendekati batas {max} (saat ini {size}).',
  webSaveBlockTitle: 'Tidak dapat menyimpan ke UniWork',
  webSaveBlockBody:
    'Dokumen ini melebihi {max}. Perubahan Anda masih ada di sini. Unduh salinan Anda ke komputer, lalu kurangi ukuran gambar atau bagi dokumen.',
  webSaveBlockDownload: 'Unduh salinan saya',
  uwConflictTooLargeWithLimit:
    'Versi Anda melebihi {max} (saat ini {size}). Pilih “Unduh salinan saya” atau tutup dialog ini untuk mengurangi ukuran file.',
  uwConflictSaveCopyTooLarge:
    'Versi Anda melebihi batas ukuran UniWork, jadi salinan tidak dapat dibuat. Tutup dialog ini untuk mengurangi ukuran file, atau pilih “Muat versi terbaru” untuk mengunduh versi Anda.',
  uwConflictSaveCopyTooLargeWithLimit:
    'Versi Anda melebihi {max} (saat ini {size}), jadi salinan tidak dapat dibuat. Tutup dialog ini untuk mengurangi ukuran file, atau pilih “Muat versi terbaru” untuk mengunduh versi Anda.',
} satisfies Record<keyof typeof zh, string>
