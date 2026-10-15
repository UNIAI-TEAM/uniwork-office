import type { zh } from './zh'

export const id = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Penyimpanan dalam antrean — belum ada di UniWork',
  uwChipQueuedNewer: 'Penyimpanan dalam antrean · ada editan baru',
  uwChipPausedAdmin: 'Penyimpanan dalam antrean · pengiriman dijeda',
  uwChipReconciling: 'Memeriksa penyimpanan terakhir…',
  uwChipReconcileStuck: 'Perlu dukungan untuk mengonfirmasi penyimpanan',
  uwChipRemoteNewer: 'Versi lebih baru di UniWork',
  uwTipQueued:
    'Simpanan Anda dari {time} tersimpan aman di komputer ini dan akan dikirim saat Anda online.',
  uwTipQueuedNewer:
    'Simpanan dari {time} sedang menunggu dikirim. Editan setelahnya tidak termasuk.',
  uwTipPausedAdmin: 'Admin Anda menjeda pengiriman. Simpanan tetap ada di komputer ini.',
  uwTipPausedUser:
    'Anda menjeda pengiriman. Simpanan dari {time} tetap di komputer ini; pilih Lanjutkan pengiriman di pusat sinkronisasi.',
  uwTipReconciling:
    'Belum jelas apakah penyimpanan terakhir sudah sampai ke UniWork. Aplikasi sedang memeriksa dan tidak akan membuat duplikat.',
  uwTipRemoteNewer: 'Anda punya perubahan yang belum disimpan, jadi dokumen tidak dimuat ulang.',
  uwTipFailed:
    'Penyimpanan ini tidak akan dicoba ulang otomatis: {reason}. Perubahan Anda tetap di komputer ini.',
  uwTipWaitAi: 'Menunggu AI menyelesaikan langkah saat ini, lalu menyimpan.',
  uwTipWaitAiLong:
    'AI belum menyelesaikan langkah saat ini. Hentikan proses AI untuk menyimpan sekarang.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Lihat antrean',
  uwActSaveAgain: 'Simpan lagi',
  uwActStopAi: 'Hentikan AI',
  uwActBack: 'Kembali',
  uwQueuePopWaiting: 'Menunggu disimpan: dari {time} (berdasarkan versi {base})',
  uwQueuePopNewer: 'Ada editan baru sejak itu — belum dikirim',
  uwQueueBlockedSave:
    'Penyimpanan terakhir Anda masih menunggu. Anda bisa menyimpan lagi setelah selesai.',
  uwQueueFull:
    'Penyimpanan sinkronisasi di komputer ini penuh, jadi penyimpanan tidak masuk antrean. Perubahan Anda masih ada di jendela yang terbuka; kosongkan ruang di pusat sinkronisasi.',
  uwQueueOpenCenter: 'Buka pusat sinkronisasi',
  uwQueueCancel: 'Batalkan penyimpanan…',
  uwQueueCancelConfirm:
    'Batalkan penyimpanan dalam antrean? Perubahan Anda tetap di komputer ini; dokumen di UniWork tidak berubah.',
  uwQueueCancelGo: 'Batalkan simpan',
  uwQueueCancelled: 'Penyimpanan dalam antrean dibatalkan. Perubahan Anda tetap di komputer ini.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'masuk lagi',
  uwReasonSignedOut: 'sudah keluar',
  uwReasonForeign: 'milik akun lain',
  uwReasonArchived: 'dokumen diarsipkan',
  uwReasonSuspended: 'organisasi ditangguhkan',
  uwReasonDeactivated: 'akun Anda dinonaktifkan di organisasi ini',
  uwReasonLease: 'akses offline kedaluwarsa',
  uwReasonKeystore: 'rantai kunci komputer ini terkunci',
  uwReasonClock: 'jam dimundurkan',
  uwReasonStoreFull: 'penyimpanan sinkronisasi di komputer ini penuh',
  uwReasonStoreNewer: 'diperlukan versi aplikasi yang lebih baru',

  // S2 queue-row badges
  uwBadgeQueued: 'Menunggu',
  uwBadgeWaitNetwork: 'Menunggu jaringan',
  uwBadgePausedUser: 'Dijeda oleh Anda',
  uwBadgePausedAdmin: 'Dijeda oleh admin',
  uwBadgeSending: 'Mengirim',
  uwBadgeReconciling: 'Memeriksa',
  uwBadgeReconcileStuck: 'Perlu dukungan',
  uwBadgeConflict: 'Konflik',
  uwBadgeBlocked: 'Diblokir',
  uwBadgeLocked: 'Terkunci',
  uwBadgeRevoked: 'Tanpa akses',
  uwBadgeDeleted: 'Dihapus',
  uwBadgeReconnect: 'Perlu sambung ulang',
  uwBadgeKeystore: 'Rantai kunci terkunci',
  uwBadgeFailed: 'Gagal mengirim',
  uwBadgeSaved: 'Tersimpan',
  uwBadgeKeptDraft: 'Draf disimpan',
  uwBadgeMoved: 'Dipindahkan',
  uwBadgeArchived: 'Diarsipkan',

  // S2 queue-row details
  uwRowQueued: 'Disimpan {time} · berdasarkan versi {base} · {size}',
  uwRowWaitNetwork: 'Akan dikirim saat online',
  uwRowPausedUser: 'Akan dikirim saat Anda memilih Lanjutkan pengiriman',
  uwRowPausedAdmin: 'Akan dikirim saat admin mengaktifkan kembali pengiriman',
  uwRowUploading: 'Mengunggah {done} / {total}',
  uwRowCommitting: 'Membuat versi',
  uwRowReconciling: 'Hasil pengiriman pada {time} belum jelas. Memeriksa dengan UniWork.',
  uwRowReconcileStuck:
    'Percobaan pencocokan: {count}, belum ada hasil. Aplikasi tidak akan mengirim ulang; kirim kode dukungan ke admin Anda.',
  uwStuckDiscardConfirm:
    'Buang penyimpanan ini? Jika sudah sampai ke UniWork, versi itu tetap ada; salinan Anda disimpan sebagai draf di pusat sinkronisasi.',
  uwRowConflict: 'Versi {n} disimpan oleh {author} pada {time}',
  uwRowFailed: 'Gagal mengirim: {reason}',
  uwRowBlocked: 'Tidak dapat menyimpan: {reason}',
  uwRowCommitted: 'Versi {n} · {time}',
  uwRowKeptDraft: 'Disimpan saat Anda memuat ulang pada {time}',
  uwRowMoved: 'Dokumen dipindahkan ke {workspace}',
  uwRowArchived: 'Dokumen diarsipkan di UniWork',

  // S2 row actions
  uwActDiscard: 'Buang',
  uwActDiscardSave: 'Buang penyimpanan…',
  uwActSendNow: 'Kirim sekarang',
  uwActRecheck: 'Periksa lagi',
  uwActGuide: 'Panduan',
  uwActOpenToResolve: 'Buka untuk menyelesaikan',
  uwActCopySupport: 'Salin kode dukungan',
  uwActDownloadMine: 'Unduh versi saya',
  uwActOpenDraft: 'Buka draf',
  uwActDiscardDraft: 'Buang draf…',
  uwActSignInAgain: 'Masuk lagi',
  uwActSignIn: 'Masuk',
  uwActSwitchAccount: 'Ganti akun',
  uwActReconnect: 'Sambungkan ulang',
  uwActDetails: 'Detail',
  uwActOpen: 'Buka',
  uwDiscardDraftConfirm:
    'Buang draf ini? Perubahannya akan dihapus dari komputer ini dan tidak dapat dipulihkan.',

  // Sign-out prompt
  uwSignOutTitle: 'Keluar dari UniWork?',
  uwSignOutBody:
    'Dokumen dengan perubahan yang belum disimpan atau penyimpanan dalam antrean: {count}. Dokumen tersebut tetap terkunci di komputer ini dan hanya akun Anda yang dapat membukanya lagi.',
  uwSignOutKeystore:
    'Rantai kunci komputer terkunci, jadi perubahan yang belum disimpan hanya ada di jendela yang terbuka. Keluar sekarang akan membuangnya; yang sudah disimpan terenkripsi tetap ada. Untuk menyimpannya, buka kunci komputer terlebih dahulu.',
  uwSignOutGo: 'Keluar',
  uwSignOutWaiting: 'Menyelesaikan penyimpanan yang sedang berjalan sebelum keluar…',
  uwSignOutCaptureFailed:
    'Beberapa perubahan yang belum disimpan tidak sempat ditangkap tepat waktu; versi tersimpan atau simpan otomatis terbaru tetap disimpan untuk akun Anda.',
  uwSwitchLostTitle: 'Sebagian perubahan yang belum disimpan dari akun sebelumnya hilang',
  uwSwitchLostBody:
    'Akun lain masuk di komputer ini, jadi akun sebelumnya dikunci. Dokumen yang perubahan belum disimpannya tidak dapat dipertahankan: {count}. Semua yang lain tetap terkunci di komputer ini untuk akun tersebut.',
  uwSwitchLostOk: 'Mengerti',

  // S2 sync center
  uwSyncTitle: 'Pusat sinkronisasi',
  uwSyncOpenFromSettings: 'Pusat sinkronisasi',
  uwSyncOnline: 'Terhubung ke UniWork · disinkronkan {time}',
  uwSyncOffline: 'Offline · terakhir disinkronkan {time}',
  uwSyncOnlineNoTime: 'Terhubung ke UniWork',
  uwSyncOfflineNoTime: 'Offline',
  uwSyncPaused: 'Pengiriman dijeda — penyimpanan baru akan menunggu',
  uwSyncAdminPaused: 'Admin Anda menjeda pengiriman. Simpanan tetap ada di komputer ini.',
  uwSyncFeedOff:
    'Pemberitahuan versi baru dijeda. UniWork tetap memeriksa konflik saat Anda menyimpan.',
  uwSyncResynced: 'Disinkronkan ulang sepenuhnya pada {time}',
  uwSyncResyncFailed:
    'Tidak dapat menyinkronkan ulang setelah beberapa kali mencoba. Pemberitahuan versi baru dijeda; UniWork tetap memeriksa konflik saat Anda menyimpan.',
  uwSyncSignedOut: 'Anda sudah keluar. Item yang disimpan terkunci di komputer ini: {count}.',
  uwSyncSignedOutEmpty: 'Anda sudah keluar.',
  uwSyncSessionExpired: 'Sesi Anda kedaluwarsa. Masuk lagi untuk terus mengirim.',
  uwSyncOtherOrg: 'Penyimpanan yang menunggu di organisasi lain: {count}',
  uwSyncStoreBudget: 'Penyimpanan sinkronisasi di komputer ini: {used} dari {cap}',
  uwSyncStoreError: 'Tidak dapat membaca antrean di komputer ini. Tidak ada yang dihapus.',
  uwSyncNow: 'Sinkronkan sekarang',
  uwSyncPause: 'Jeda pengiriman',
  uwSyncResume: 'Lanjutkan pengiriman',
  uwSyncNowOffline: 'Sinkronisasi memerlukan koneksi.',
  uwSyncTabAttention: 'Perlu tindakan',
  uwSyncTabQueue: 'Menunggu disimpan',
  uwSyncTabOffline: 'Tersedia offline',
  uwSyncTabRecent: 'Baru disimpan',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Dokumen',
  uwSyncColState: 'Status',
  uwSyncColDetail: 'Detail',
  uwSyncColActions: 'Tindakan',
  uwSyncMoreActions: 'Tindakan lain untuk {doc}',
  uwSyncEmptyQueue: 'Tidak ada yang menunggu disimpan.',
  uwSyncEmptyAttention: 'Tidak ada yang perlu ditindaklanjuti.',
  uwSyncEmptyRecent: 'Tidak ada penyimpanan terbaru.',
  uwSyncActionFailed: 'Tidak berhasil. Tidak ada yang dihapus; coba lagi.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Sediakan offline',
  uwOfflineUnpin: 'Hapus salinan offline',
  uwOfflineUnpinShort: 'Lepas sematan',
  uwOfflineAdd: 'Tambahkan dokumen…',
  uwOfflineUsage: 'Menggunakan {used} dari {cap} di komputer ini',
  uwOfflineEmpty: 'Belum ada dokumen yang tersedia offline.',
  uwOfflineCapReached:
    'Pustaka offline di komputer ini sudah mencapai batas: penyimpanan {cap}; dokumen maksimum: {maxDocs}. Hapus satu salinan offline untuk menambahkan yang lain.',
  uwOfflineReady: 'Tersedia offline',
  uwOfflineBadgeWaiting: 'Menunggu jaringan',
  uwOfflineBadgeDownloading: 'Mengunduh',
  uwOfflineBadgeVerifying: 'Memverifikasi',
  uwOfflineBadgeUpdate: 'Pembaruan tersedia',
  uwOfflineBadgeInterrupted: 'Belum siap',
  uwOfflineBadgeDiskFull: 'Ruang tidak cukup',
  uwOfflineBadgeCorrupt: 'Unduhan rusak',
  uwOfflineBadgeLeaseSoon: 'Akses offline segera berakhir',
  uwOfflineBadgeViewOnly: 'Tersedia offline · hanya lihat',
  uwOfflineRowWaiting: 'Akan diunduh saat online',
  uwOfflineRowProgress: '{done} dari {total}',
  uwOfflineRowProgressAria: '{done} dari {total}',
  uwOfflineRowVerifying: 'Memeriksa integritas',
  uwOfflineRowReady: 'Versi {n} · {size} · akses offline hingga {datetime}',
  uwOfflineRowUpdate: 'Versi {n} akan diunduh saat online; versi {old} masih bisa dipakai',
  uwOfflineRowUpdateKept:
    'Tidak dapat memperbarui ke versi {n}: {reason}. Versi {old} masih bisa dipakai.',
  uwOfflineRowInterrupted: 'Unduhan terputus. Salinan lama (jika ada) masih bisa dipakai.',
  uwOfflineRowDiskFull: 'Perlu {size} lagi. Salinan lama tetap disimpan.',
  uwOfflineRowCorrupt: 'Salinan yang rusak telah dihapus. Unduh lagi.',
  uwOfflineRowLeaseSoon: 'Hubungkan sebelum {datetime} untuk memperpanjang',
  uwOfflineRowRevoked:
    'Anda tidak lagi memiliki akses ke dokumen ini. Salinan yang diunduh telah dihapus; draf tetap terkunci.',
  uwOfflineRowDeleted:
    'Dokumen dihapus di UniWork. Salinan yang diunduh telah dihapus; draf tetap terkunci.',
  uwOfflineRowArchived:
    'Dokumen diarsipkan; salinan di sini dapat dibuka sampai akses offline berakhir.',
  uwOfflineRowMoved: 'Dipindahkan ke {workspace}; salinan di sini masih bisa dipakai.',
  uwOfflineRowViewOnly: 'Versi {n} · hanya lihat · akses offline hingga {datetime}',
  uwOfflineReadyAnnounce: 'Tersedia offline: {doc}',
  uwOfflineUnpinConfirm:
    'Salinan yang diunduh akan dihapus dari komputer ini. Draf dan penyimpanan dalam antrean tetap disimpan.',
  uwOfflineCancelDownload: 'Batalkan unduhan',
  uwOfflineDownloadNow: 'Unduh sekarang',
  uwOfflineOpenFolder: 'Buka folder penyimpanan',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Perlu sambung ulang',
  uwLockKeystoreTitle: 'Rantai kunci komputer ini terkunci',
  uwLockClockTitle: 'Perlu pemeriksaan waktu',
  uwLockRevokedTitle: 'Tanpa akses',
  uwLockDeletedTitle: 'Dokumen dihapus',
  uwLockForeignTitle: 'Milik akun lain',
  uwLockOrgTitle: 'Tidak dapat dibuka di organisasi ini',
  uwLockExpired:
    'Akses offline kedaluwarsa. Konten tetap terenkripsi; hubungkan untuk membukanya lagi.',
  uwLockLibraryOff:
    'Admin Anda menonaktifkan dokumen offline, jadi akses offline tidak dapat diperpanjang. Draf tetap terkunci di pusat sinkronisasi.',
  uwLockKeystore:
    'Rantai kunci komputer terkunci, jadi konten terenkripsi tidak dapat dibuka. Buka kuncinya lalu coba lagi; tidak ada yang dihapus.',
  uwLockClock:
    'Jam komputer dimundurkan, jadi akses offline terkunci. Hubungkan agar UniWork dapat memeriksa waktu.',
  uwLockForeign:
    'Dokumen ini milik akun lain di komputer ini. Beralihlah ke akun tersebut untuk membukanya.',
  uwLockSuspended: 'Organisasi ditangguhkan. Konten tetap terenkripsi; hubungi admin Anda.',
  uwLockDeactivated:
    'Akun Anda dinonaktifkan di organisasi ini. Konten tetap terenkripsi; hubungi admin Anda.',
  uwLockSignedOutTitle: 'Anda sudah keluar',
  uwLockSignedOut:
    'Konten tetap terkunci di komputer ini. Masuk dengan akun yang sama untuk membukanya lagi.',
  uwLockRegion: 'Status dokumen',
  uwLockWhileOpen:
    'Dokumen terkunci saat sedang dibuka. Perubahan yang belum disimpan tetap terenkripsi; Anda tidak dapat menyimpan atau menyalin hingga kuncinya dibuka.',
  uwLockWhileOpenRam:
    'Dokumen terkunci saat sedang dibuka dan komputer ini belum dapat menyimpan perubahan Anda dengan aman. Perubahan hanya ada di jendela ini (hanya lihat); menutupnya akan menghilangkannya.',
  uwLockOtherWindow:
    'Dokumen ini sedang dibuka untuk diedit di jendela lain. Jendela ini hanya untuk melihat.',
  uwLockOtherWindowGone:
    'Jendela yang mengedit dokumen ini berhenti merespons. Anda dapat mengedit di jendela ini.',
  uwLockGoToWindow: 'Buka jendela itu',
  uwLockTakeEdit: 'Edit di jendela ini',

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
  uwConflictSaveCopyTitle: 'Simpan sebagai salinan?',
  uwConflictSaveCopyConfirm:
    'UniWork akan membuat dokumen baru dari versi Anda, dengan pemilik dan akses yang sama seperti dokumen ini. Dokumen saat ini dan versi {server} oleh {author} tetap seperti semula.',
  uwConflictSaveCopyGo: 'Buat salinan',
  uwConflictSaveCopyDone:
    'Versi Anda disimpan sebagai dokumen baru: {title}. Dokumen ini tidak berubah; Anda masih bisa memuat ulang atau menimpa.',
  uwConflictSaveCopyFailed: 'Tidak dapat membuat salinan. Perubahan Anda tetap aman; coba lagi.',
  uwConflictSaveCopyNoSeat:
    'Tidak dapat membuat salinan karena Anda bukan anggota ruang kerja tempat dokumen ini berada. Perubahan Anda tetap aman; Anda bisa mengunduh versi Anda.',
  uwConflictSaveCopyFolderRefused:
    'Anda tidak dapat membuat dokumen di folder ini. Unduh versi Anda sebagai gantinya.',
  uwConflictDownloadDone:
    'Versi Anda disimpan di komputer ini: {file}. Dokumen ini tidak berubah; Anda masih bisa memuat ulang atau menimpa.',
  uwConflictDownloadFailedDesktop:
    'Tidak dapat menyimpan file. Perubahan Anda tetap aman; coba lagi.',
  uwConflictSaveCopyOffline:
    'Anda sedang offline. Membuat salinan memerlukan koneksi; perubahan Anda tetap disimpan.',
  uwConflictReloadFailed:
    'Tidak dapat memuat versi terbaru. Dokumen Anda tidak berubah; coba lagi.',
  uwConflictOverwriteFailed: 'Belum dapat menimpa. Dokumen Anda tidak berubah; coba lagi.',
  uwConflictClose: 'Tutup',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Dokumen ini diubah di tempat lain',
  uwConflictBody: 'Perubahan Anda belum ada di UniWork dan aman di komputer ini.',
  uwConflictReload: 'Muat ulang versi terbaru',
  uwConflictOverwrite: 'Timpa…',
  uwConflictCancel: 'Batal',
  uwConflictKeepUnavailable:
    'Komputer ini tidak dapat menyimpan draf saat ini (penyimpanan sinkronisasi penuh atau rantai kunci terkunci).',
  uwConflictOfflineDesktop:
    'Anda sedang offline dan versi terbaru tidak ada di komputer ini, jadi belum bisa dimuat ulang.',
  uwConflictReloadDesktopBody:
    'Pilih apa yang terjadi pada perubahan Anda sebelum versi {n} dimuat.',
  uwConflictKeepDraft: 'Simpan versi saya sebagai draf',
  uwConflictDiscard: 'Buang perubahan saya',
  uwConflictKeepDraftHint:
    'Draf tetap ada di pusat sinkronisasi untuk dilihat atau disalin; draf tidak pernah diterapkan otomatis ke versi baru.',
  uwConflictDraftCapReached:
    'Dokumen ini telah mencapai jumlah maksimum draf yang disimpan: {cap}. Buang draf lama di pusat sinkronisasi untuk menyimpan yang lain.',

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

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'Penyimpanan sebelumnya memerlukan dukungan, jadi Anda belum bisa memuat ulang atau menimpa. Buka pusat sinkronisasi untuk menyelesaikannya.',
  uwRemoteRevoked:
    'Anda tidak lagi memiliki akses ke dokumen ini. Penyimpanan dihentikan; perubahan yang belum disimpan tetap terkunci di komputer ini.',
} satisfies Record<keyof typeof zh, string>
