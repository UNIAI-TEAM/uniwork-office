import type { zh } from './zh'

export const ms = {
  webCancel: 'Batal',
  webConflictTitle: 'Dokumen ini telah diubah di tempat lain',
  webConflictBody:
    'Perubahan anda belum ada di UniWork dan disimpan dalam pelayar ini sehingga anda log keluar.',
  webConflictOverwrite: 'Tulis ganti…',
  webConflictReload: 'Muat semula versi terkini',
  webConflictNotSaved: 'dokumen telah diubah di tempat lain',
  webFatalTitle: 'Dokumen tidak dapat dibuka',
  webFatalBody:
    'Penyuntingan dan penyimpanan dilumpuhkan. Muat semula halaman atau buka semula dokumen daripada UniWork.',
  webNoHost: 'Editor ini berjalan di dalam UniWork. Buka dokumen daripada UniWork.',
  webViewOnly: 'Lihat sahaja',
  webViewOnlyNotSaved: 'Dokumen ini untuk dilihat sahaja dan tidak boleh disimpan',
  webNotUtf8:
    'Fail ini bukan teks UTF-8. Ia dibuka untuk dilihat sahaja supaya simpanan tidak mengubah kandungannya',
  webDraftTitle: 'Pulihkan perubahan yang belum disimpan?',
  webDraftBody:
    'Pelayar ini menyimpan salinan perubahan pada dokumen ini yang belum disimpan. Pulihkan atau buang?',
  webDraftOlder:
    'Salinan ini berdasarkan versi dokumen yang lebih lama. Menyimpannya akan menggantikan versi yang lebih baharu.',
  webDraftSavedAt: 'Salinan disimpan pada',
  webDraftKept: 'Pelayar ini menyimpan salinan sehingga anda log keluar.',
  webDraftRestore: 'Pulihkan',
  webDraftDiscard: 'Buang',
  webSaveNetwork: 'UniWork tidak dapat dicapai. Semak sambungan anda dan cuba lagi.',
  webSaveTimeout: 'Penyimpanan mengambil masa terlalu lama. Semak sambungan anda dan cuba lagi.',
  webClose: 'Tutup',
  webSaveUnauthorized:
    'Sesi UniWork anda telah tamat. Log masuk semula, kemudian cuba simpan lagi.',
  webSaveForbidden: 'Anda tiada kebenaran untuk menyimpan dokumen ini.',
  webSaveNotFound: 'Dokumen ini sudah tiada atau telah dialihkan.',
  webSaveTooLarge: 'Dokumen terlalu besar untuk disimpan.',
  webSaveRateLimited: 'Terlalu banyak permintaan. Tunggu sebentar dan cuba lagi.',
  webSaveServer: 'UniWork menghadapi masalah semasa menyimpan. Cuba lagi sebentar lagi.',
  webSaveFailedGeneric: 'Dokumen tidak dapat disimpan. Cuba lagi.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Perubahan anda belum ada di UniWork dan disimpan dalam pelayar ini sehingga anda log keluar.',
  uwConflictReloadWebBody:
    'Pelayar tidak menyimpan draf konflik. Muat turun versi anda untuk disalin kemudian, atau buang perubahan anda.',
  uwConflictDownloadThenReload: 'Muat turun versi saya, kemudian muat semula',
  uwConflictDiscardThenReload: 'Buang perubahan dan muat semula',
  uwConflictMineFileSuffix: '(versi saya)',
  uwConflictDownloadCheck:
    'Pelayar anda menerima fail anda. Semak bahawa ia telah disimpan, kemudian pilih Muat semula.',
  uwConflictSessionWeb:
    'Sesi anda telah tamat tempoh, jadi tulis ganti tidak berlaku. Perubahan anda kekal dalam pelayar ini; log masuk semula dan cuba lagi.',
  uwConflictTooLarge: 'Versi anda melebihi had saiz UniWork, jadi tidak dapat menulis ganti.',
  uwConflictDownloadTooLarge:
    'Versi anda melebihi had saiz UniWork, jadi tidak dapat dimuat turun di sini.',
  uwConflictDownloadFailed:
    'Tidak dapat memuat turun versi anda, jadi dokumen tidak dimuat semula. Cuba lagi.',
  uwConflictOfflineWeb:
    'Anda di luar talian. Di web, ini memerlukan sambungan; perubahan anda kekal dalam pelayar ini.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Versi anda',
  uwConflictColServer: 'Versi di UniWork',
  uwConflictRowVersion: 'Versi',
  uwConflictRowTime: 'Masa',
  uwConflictRowBy: 'Disimpan oleh',
  uwConflictMineUnsaved: 'Anda (belum disimpan)',
  uwConflictBasedOn: 'berdasarkan versi {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Lihat perbezaan',
  uwConflictDiffPending: 'Sedang membandingkan…',
  uwConflictDiffFailed: 'Versi tidak dapat dibandingkan sekarang. Cuba lagi nanti.',
  uwConflictNoEdit: 'Anda tidak lagi mempunyai akses suntingan kepada dokumen ini.',
  uwConflictOverwriteTitle: 'Tulis ganti dengan versi anda?',
  uwConflictOverwriteConfirm:
    'UniWork akan mencipta versi {next} daripada salinan anda. Versi {server} oleh {author} kekal dalam sejarah.',
  uwConflictOverwriteGo: 'Tulis ganti',
  uwConflictBack: 'Kembali',
  uwConflictHeadMoved:
    'Sementara itu UniWork mendapat versi {n}. Jadual telah dikemas kini; pilih semula.',
  uwConflictReloadTitle: 'Muat semula versi terkini',
  uwConflictReloadGo: 'Muat semula',
  uwConflictSaveCopy: 'Simpan sebagai salinan…',
  uwConflictSaveCopyName: '{name} (salinan)',
  uwConflictSaveCopyTitle: 'Simpan sebagai salinan?',
  uwConflictSaveCopyConfirm:
    'UniWork akan mencipta dokumen baharu daripada versi anda, dengan pemilik dan akses yang sama seperti dokumen ini. Dokumen semasa dan versi {server} oleh {author} kekal seperti sedia ada.',
  uwConflictSaveCopyGo: 'Cipta salinan',
  uwConflictSaveCopyDone:
    'Versi anda disimpan sebagai dokumen baharu: {title}. Dokumen ini tidak berubah; anda masih boleh memuat semula atau menulis ganti.',
  uwConflictSaveCopyFailed:
    'Tidak dapat mencipta salinan. Perubahan anda masih selamat; cuba lagi.',
  uwConflictSaveCopyOffline:
    'Anda di luar talian. Mencipta salinan memerlukan sambungan; perubahan anda disimpan.',
  uwConflictReloadFailed:
    'Tidak dapat memuatkan versi terkini. Dokumen anda tidak berubah; cuba lagi.',
  uwConflictOverwriteFailed: 'Belum dapat menulis ganti. Dokumen anda tidak berubah; cuba lagi.',
  uwConflictClose: 'Tutup',

  // S6 new-version bar
  uwRemoteRegion: 'Versi baharu',
  uwRemoteUpdated: 'Dikemas kini ke versi {n}, disimpan oleh {author} pada {time}.',
  uwRemoteUpdatedNoRev: 'Dikemas kini ke versi terkini di UniWork.',
  uwRemoteNewerDirty:
    'Terdapat versi lebih baharu di UniWork (versi {n}). Anda mempunyai perubahan yang belum disimpan, jadi dokumen tidak dimuatkan semula.',
  uwRemoteNewerAi:
    'Terdapat versi lebih baharu di UniWork (versi {n}). UniWork AI sedang berjalan, jadi dokumen tidak dimuatkan semula; hasil AI hanya digunakan pada salinan yang terbuka.',
  uwRemoteNowClean:
    'Anda telah membuat asal semua perubahan. Versi {n} di UniWork lebih baharu daripada salinan yang terbuka.',
  uwRemoteStopAiConfirm:
    'Hentikan larian UniWork AI yang sedang berjalan untuk memuat semula? Perubahan yang telah dibuat AI milik salinan yang terbuka.',
  uwRemoteWaitCommit:
    'Menunggu simpanan yang sedang berjalan selesai; anda boleh memuat semula selepas itu.',
  uwRemoteReload: 'Muat semula versi terkini…',
  uwRemoteLater: 'Kemudian',
  uwRemoteClose: 'Tutup',
  uwRemoteReloadFailed: 'Tidak dapat memuatkan versi {n}. Anda masih melihat versi sebelumnya.',
  uwRemoteDeleted: 'Dokumen ini dipadam di UniWork. Simpanan dalam baris gilir dihentikan.',
  uwAuthorFallback: 'seorang ahli',
  uwLockRegion: 'Status dokumen',
  uwActRetry: 'Cuba lagi',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'Anda tidak lagi mempunyai akses kepada dokumen ini. Penyimpanan dihentikan; perubahan yang belum disimpan disimpan dalam pelayar ini sehingga anda log keluar.',
  uwRemoteOrgBlockedWeb:
    'Tidak dapat menyimpan: {reason}. Perubahan yang belum disimpan disimpan dalam pelayar ini sehingga anda log keluar.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'dokumen diarkibkan',
  uwReasonSuspended: 'organisasi digantung',
  uwReasonDeactivated: 'akaun anda dinyahaktifkan dalam organisasi ini',

  webSizeWarnChip: 'Menghampiri had {max} (kini {size}).',
  webSaveBlockTitle: 'Tidak dapat menyimpan ke UniWork',
  webSaveBlockBody:
    'Dokumen ini melebihi {max}. Perubahan anda masih ada di sini. Muat turun salinan anda ke komputer, kemudian kurangkan saiz imej atau bahagikan dokumen.',
  webSaveBlockDownload: 'Muat turun salinan saya',
  uwConflictTooLargeWithLimit:
    'Versi anda melebihi {max} (kini {size}). Pilih “Muat turun salinan saya” atau tutup dialog ini untuk mengurangkan saiz fail.',
} satisfies Record<keyof typeof zh, string>
