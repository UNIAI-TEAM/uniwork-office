import type { zh } from './zh'

export const ms = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Simpanan dalam baris gilir — belum ada di UniWork',
  uwChipQueuedNewer: 'Simpanan dalam baris gilir · suntingan lebih baharu',
  uwChipPausedAdmin: 'Simpanan dalam baris gilir · penghantaran dijeda',
  uwChipReconciling: 'Menyemak simpanan terakhir…',
  uwChipReconcileStuck: 'Sokongan diperlukan untuk mengesahkan simpanan',
  uwChipRemoteNewer: 'Versi lebih baharu di UniWork',
  uwTipQueued:
    'Simpanan anda dari {time} disimpan dengan selamat pada komputer ini dan akan dihantar apabila anda dalam talian.',
  uwTipQueuedNewer:
    'Simpanan dari {time} sedang menunggu untuk dihantar. Suntingan selepas itu tidak termasuk.',
  uwTipPausedAdmin:
    'Pentadbir anda telah menjeda penghantaran. Simpanan disimpan pada komputer ini.',
  uwTipPausedUser:
    'Anda telah menjeda penghantaran. Simpanan dari {time} disimpan pada komputer ini; pilih Sambung semula penghantaran di pusat penyegerakan.',
  uwTipReconciling:
    'Belum jelas sama ada simpanan terakhir telah sampai ke UniWork. Apl sedang menyemak dan tidak akan mencipta pendua.',
  uwTipRemoteNewer:
    'Anda mempunyai perubahan yang belum disimpan, jadi dokumen tidak dimuatkan semula.',
  uwTipFailed:
    'Simpanan ini tidak akan dicuba semula sendiri: {reason}. Perubahan anda kekal pada komputer ini.',
  uwTipWaitAi: 'Menunggu AI menyelesaikan langkah semasa, kemudian menyimpan.',
  uwTipWaitAiLong:
    'AI belum menyelesaikan langkah semasa. Hentikan larian AI untuk menyimpan sekarang.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Lihat baris gilir',
  uwActSaveAgain: 'Simpan semula',
  uwActStopAi: 'Hentikan AI',
  uwActBack: 'Kembali',
  uwQueuePopWaiting: 'Menunggu untuk disimpan: dari {time} (berdasarkan versi {base})',
  uwQueuePopNewer: 'Suntingan lebih baharu sejak itu — belum dihantar',
  uwQueueBlockedSave:
    'Simpanan terakhir anda masih menunggu. Anda boleh menyimpan semula selepas ia selesai.',
  uwQueueFull:
    'Storan penyegerakan pada komputer ini penuh, jadi simpanan tidak dimasukkan ke baris gilir. Perubahan anda masih dalam tetingkap yang terbuka; kosongkan ruang di pusat penyegerakan.',
  uwQueueOpenCenter: 'Buka pusat penyegerakan',
  uwQueueCancel: 'Batalkan simpanan…',
  uwQueueCancelConfirm:
    'Batalkan simpanan dalam baris gilir? Perubahan anda kekal pada komputer ini; dokumen di UniWork tidak berubah.',
  uwQueueCancelled:
    'Simpanan dalam baris gilir dibatalkan. Perubahan anda kekal pada komputer ini.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'log masuk semula',
  uwReasonSignedOut: 'telah log keluar',
  uwReasonForeign: 'milik akaun lain',
  uwReasonArchived: 'dokumen diarkibkan',
  uwReasonSuspended: 'organisasi digantung',
  uwReasonDeactivated: 'akaun anda dinyahaktifkan dalam organisasi ini',
  uwReasonLease: 'akses luar talian tamat tempoh',
  uwReasonKeystore: 'rantai kunci komputer ini dikunci',
  uwReasonClock: 'jam telah diundurkan',
  uwReasonStoreFull: 'storan penyegerakan pada komputer ini penuh',
  uwReasonStoreNewer: 'versi apl yang lebih baharu diperlukan',

  // S2 queue-row badges
  uwBadgeQueued: 'Menunggu',
  uwBadgeWaitNetwork: 'Menunggu rangkaian',
  uwBadgePausedUser: 'Dijeda oleh anda',
  uwBadgePausedAdmin: 'Dijeda oleh pentadbir',
  uwBadgeSending: 'Menghantar',
  uwBadgeReconciling: 'Menyemak',
  uwBadgeReconcileStuck: 'Perlu sokongan',
  uwBadgeConflict: 'Konflik',
  uwBadgeBlocked: 'Disekat',
  uwBadgeLocked: 'Dikunci',
  uwBadgeRevoked: 'Tiada akses',
  uwBadgeDeleted: 'Dipadam',
  uwBadgeReconnect: 'Perlu sambung semula',
  uwBadgeKeystore: 'Rantai kunci dikunci',
  uwBadgeFailed: 'Tidak dapat dihantar',
  uwBadgeSaved: 'Disimpan',
  uwBadgeKeptDraft: 'Draf disimpan',
  uwBadgeMoved: 'Dipindahkan',
  uwBadgeArchived: 'Diarkibkan',

  // S2 queue-row details
  uwRowQueued: 'Disimpan {time} · berdasarkan versi {base} · {size}',
  uwRowWaitNetwork: 'Akan dihantar apabila dalam talian',
  uwRowPausedUser: 'Akan dihantar apabila anda memilih Sambung semula penghantaran',
  uwRowPausedAdmin: 'Akan dihantar apabila pentadbir menghidupkan semula penghantaran',
  uwRowUploading: 'Memuat naik {done} / {total}',
  uwRowCommitting: 'Mencipta versi',
  uwRowReconciling: 'Hasil penghantaran pada {time} belum jelas. Menyemak dengan UniWork.',
  uwRowReconcileStuck:
    'Cubaan penyesuaian: {count}, belum ada hasil. Apl tidak akan menghantar semula; hantar kod sokongan kepada pentadbir anda.',
  uwStuckDiscardConfirm:
    'Buang simpanan ini? Jika ia sudah sampai ke UniWork, versi itu kekal; salinan anda disimpan sebagai draf di pusat penyegerakan.',
  uwRowConflict: 'Versi {n} disimpan oleh {author} pada {time}',
  uwRowFailed: 'Tidak dapat dihantar: {reason}',
  uwRowBlocked: 'Tidak dapat menyimpan: {reason}',
  uwRowCommitted: 'Versi {n} · {time}',
  uwRowKeptDraft: 'Disimpan semasa anda memuat semula pada {time}',
  uwRowMoved: 'Dokumen dipindahkan ke {workspace}',
  uwRowArchived: 'Dokumen diarkibkan di UniWork',

  // S2 row actions
  uwActDiscard: 'Buang',
  uwActDiscardSave: 'Buang simpanan…',
  uwActSendNow: 'Hantar sekarang',
  uwActRecheck: 'Semak semula',
  uwActGuide: 'Panduan',
  uwActOpenToResolve: 'Buka untuk diselesaikan',
  uwActCopySupport: 'Salin kod sokongan',
  uwActDownloadMine: 'Muat turun versi saya',
  uwActOpenDraft: 'Buka draf',
  uwActDiscardDraft: 'Buang draf…',
  uwActSignInAgain: 'Log masuk semula',
  uwActSignIn: 'Log masuk',
  uwActSwitchAccount: 'Tukar akaun',
  uwActReconnect: 'Sambung semula',
  uwActDetails: 'Butiran',
  uwActOpen: 'Buka',
  uwDiscardDraftConfirm:
    'Buang draf ini? Perubahannya akan dialih keluar dari komputer ini dan tidak boleh dipulihkan.',

  // Sign-out prompt
  uwSignOutTitle: 'Log keluar daripada UniWork?',
  uwSignOutBody:
    'Dokumen dengan perubahan yang belum disimpan atau simpanan dalam baris gilir: {count}. Dokumen itu kekal dikunci pada komputer ini dan hanya akaun anda boleh membukanya semula.',
  uwSignOutKeystore:
    'Rantai kunci komputer dikunci, jadi perubahan yang belum disimpan hanya wujud dalam tetingkap yang terbuka. Log keluar sekarang akan membuangnya; apa-apa yang sudah disimpan secara tersulit kekal. Untuk menyimpannya, buka kunci komputer dahulu.',
  uwSignOutGo: 'Log keluar',
  uwSignOutWaiting: 'Menyelesaikan simpanan yang sedang berjalan sebelum log keluar…',
  uwSignOutCaptureFailed:
    'Sesetengah perubahan yang belum disimpan tidak dapat ditangkap tepat pada masanya; versi autosimpan terakhir disimpan untuk akaun anda.',

  // S2 sync center
  uwSyncTitle: 'Pusat penyegerakan',
  uwSyncOpenFromSettings: 'Pusat penyegerakan',
  uwSyncOnline: 'Disambungkan ke UniWork · disegerakkan {time}',
  uwSyncOffline: 'Luar talian · kali terakhir disegerakkan {time}',
  uwSyncPaused: 'Penghantaran dijeda — simpanan baharu akan menunggu',
  uwSyncAdminPaused:
    'Pentadbir anda telah menjeda penghantaran. Simpanan disimpan pada komputer ini.',
  uwSyncFeedOff:
    'Notis versi baharu dijeda. UniWork masih menyemak konflik apabila anda menyimpan.',
  uwSyncResynced: 'Disegerakkan semula sepenuhnya pada {time}',
  uwSyncResyncFailed:
    'Tidak dapat menyegerakkan semula selepas beberapa cubaan. Notis versi baharu dijeda; UniWork masih menyemak konflik apabila anda menyimpan.',
  uwSyncSignedOut: 'Anda telah log keluar. Item yang disimpan berkunci pada komputer ini: {count}.',
  uwSyncSignedOutEmpty: 'Anda telah log keluar.',
  uwSyncSessionExpired: 'Sesi anda telah tamat tempoh. Log masuk semula untuk terus menghantar.',
  uwSyncOtherOrg: 'Simpanan yang menunggu dalam organisasi lain: {count}',
  uwSyncStoreBudget: 'Storan penyegerakan pada komputer ini: {used} daripada {cap}',
  uwSyncStoreError:
    'Tidak dapat membaca baris gilir pada komputer ini. Tiada apa-apa yang dipadam.',
  uwSyncNow: 'Segerakkan sekarang',
  uwSyncPause: 'Jeda penghantaran',
  uwSyncResume: 'Sambung semula penghantaran',
  uwSyncNowOffline: 'Penyegerakan memerlukan sambungan.',
  uwSyncTabAttention: 'Perlu perhatian',
  uwSyncTabQueue: 'Menunggu untuk disimpan',
  uwSyncTabOffline: 'Tersedia luar talian',
  uwSyncTabRecent: 'Disimpan baru-baru ini',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Dokumen',
  uwSyncColState: 'Status',
  uwSyncColDetail: 'Butiran',
  uwSyncColActions: 'Tindakan',
  uwSyncMoreActions: 'Tindakan lain untuk {doc}',
  uwSyncEmptyQueue: 'Tiada apa-apa yang menunggu untuk disimpan.',
  uwSyncEmptyAttention: 'Tiada apa-apa yang perlu diberi perhatian.',
  uwSyncEmptyRecent: 'Tiada simpanan terkini.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Jadikan tersedia luar talian',
  uwOfflineUnpin: 'Alih keluar salinan luar talian',
  uwOfflineUnpinShort: 'Nyahsemat',
  uwOfflineAdd: 'Tambah dokumen…',
  uwOfflineUsage: 'Menggunakan {used} daripada {cap} pada komputer ini',
  uwOfflineEmpty: 'Belum ada dokumen yang tersedia luar talian.',
  uwOfflineCapReached:
    'Pustaka luar talian pada komputer ini telah mencapai had: storan {cap}; dokumen maksimum: {maxDocs}. Alih keluar satu salinan luar talian untuk menambah yang lain.',
  uwOfflineReady: 'Tersedia luar talian',
  uwOfflineBadgeWaiting: 'Menunggu rangkaian',
  uwOfflineBadgeDownloading: 'Memuat turun',
  uwOfflineBadgeVerifying: 'Mengesahkan',
  uwOfflineBadgeUpdate: 'Kemas kini tersedia',
  uwOfflineBadgeInterrupted: 'Belum sedia',
  uwOfflineBadgeDiskFull: 'Ruang tidak mencukupi',
  uwOfflineBadgeCorrupt: 'Muat turun rosak',
  uwOfflineBadgeLeaseSoon: 'Akses luar talian akan tamat',
  uwOfflineBadgeViewOnly: 'Tersedia luar talian · lihat sahaja',
  uwOfflineRowWaiting: 'Akan dimuat turun apabila dalam talian',
  uwOfflineRowProgress: '{done} daripada {total}',
  uwOfflineRowProgressAria: '{done} daripada {total}',
  uwOfflineRowVerifying: 'Menyemak integriti',
  uwOfflineRowReady: 'Versi {n} · {size} · akses luar talian hingga {datetime}',
  uwOfflineRowUpdate:
    'Versi {n} akan dimuat turun apabila dalam talian; versi {old} masih berfungsi',
  uwOfflineRowUpdateKept:
    'Tidak dapat mengemas kini ke versi {n}: {reason}. Versi {old} masih berfungsi.',
  uwOfflineRowInterrupted: 'Muat turun terganggu. Salinan lama (jika ada) masih berfungsi.',
  uwOfflineRowDiskFull: '{size} lagi diperlukan. Salinan lama disimpan.',
  uwOfflineRowCorrupt: 'Salinan yang rosak telah dialih keluar. Muat turun semula.',
  uwOfflineRowLeaseSoon: 'Sambung sebelum {datetime} untuk memperbaharui',
  uwOfflineRowRevoked:
    'Anda tidak lagi mempunyai akses kepada dokumen ini. Salinan yang dimuat turun telah dialih keluar; draf kekal dikunci.',
  uwOfflineRowDeleted:
    'Dokumen dipadam di UniWork. Salinan yang dimuat turun telah dialih keluar; draf kekal dikunci.',
  uwOfflineRowArchived:
    'Dokumen diarkibkan; salinan di sini boleh dibuka sehingga akses luar talian tamat.',
  uwOfflineRowMoved: 'Dipindahkan ke {workspace}; salinan di sini masih berfungsi.',
  uwOfflineRowViewOnly: 'Versi {n} · lihat sahaja · akses luar talian hingga {datetime}',
  uwOfflineReadyAnnounce: 'Tersedia luar talian: {doc}',
  uwOfflineUnpinConfirm:
    'Salinan yang dimuat turun akan dialih keluar dari komputer ini. Draf dan simpanan dalam baris gilir disimpan.',
  uwOfflineCancelDownload: 'Batalkan muat turun',
  uwOfflineDownloadNow: 'Muat turun sekarang',
  uwOfflineOpenFolder: 'Buka folder storan',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Perlu sambung semula',
  uwLockKeystoreTitle: 'Rantai kunci komputer ini dikunci',
  uwLockClockTitle: 'Semakan masa diperlukan',
  uwLockRevokedTitle: 'Tiada akses',
  uwLockDeletedTitle: 'Dokumen dipadam',
  uwLockForeignTitle: 'Milik akaun lain',
  uwLockOrgTitle: 'Tidak boleh dibuka dalam organisasi ini',
  uwLockExpired:
    'Akses luar talian telah tamat tempoh. Kandungan kekal tersulit; sambung untuk membukanya semula.',
  uwLockLibraryOff:
    'Pentadbir anda telah mematikan dokumen luar talian, jadi akses luar talian tidak boleh diperbaharui. Draf kekal dikunci di pusat penyegerakan.',
  uwLockKeystore:
    'Rantai kunci komputer dikunci, jadi kandungan tersulit tidak boleh dibuka. Buka kuncinya dan cuba lagi; tiada apa-apa yang dipadam.',
  uwLockClock:
    'Jam komputer telah diundurkan, jadi akses luar talian dikunci. Sambung supaya UniWork boleh menyemak masa.',
  uwLockForeign:
    'Dokumen ini milik akaun lain pada komputer ini. Tukar ke akaun itu untuk membukanya.',
  uwLockSuspended: 'Organisasi digantung. Kandungan kekal tersulit; hubungi pentadbir anda.',
  uwLockDeactivated:
    'Akaun anda dinyahaktifkan dalam organisasi ini. Kandungan kekal tersulit; hubungi pentadbir anda.',
  uwLockSignedOutTitle: 'Anda telah log keluar',
  uwLockSignedOut:
    'Kandungan kekal dikunci pada komputer ini. Log masuk dengan akaun yang sama untuk membukanya semula.',
  uwLockRegion: 'Status dokumen',
  uwLockWhileOpen:
    'Dokumen dikunci semasa dibuka. Perubahan yang belum disimpan disimpan secara tersulit; anda tidak boleh menyimpan atau menyalin sehingga ia dibuka kunci.',
  uwLockWhileOpenRam:
    'Dokumen dikunci semasa dibuka dan komputer ini belum dapat menyimpan perubahan anda dengan selamat. Perubahan hanya wujud dalam tetingkap ini (lihat sahaja); menutupnya akan menghilangkannya.',
  uwLockOtherWindow:
    'Dokumen ini dibuka untuk disunting dalam tetingkap lain. Tetingkap ini untuk melihat sahaja.',
  uwLockOtherWindowGone:
    'Tetingkap yang menyunting dokumen ini berhenti bertindak balas. Anda boleh menyunting dalam tetingkap ini.',
  uwLockGoToWindow: 'Pergi ke tetingkap itu',
  uwLockTakeEdit: 'Sunting dalam tetingkap ini',

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

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Dokumen ini telah diubah di tempat lain',
  uwConflictBody: 'Perubahan anda belum ada di UniWork dan selamat pada komputer ini.',
  uwConflictReload: 'Muat semula versi terkini',
  uwConflictOverwrite: 'Tulis ganti…',
  uwConflictCancel: 'Batal',
  uwConflictKeepUnavailable:
    'Komputer ini tidak dapat menyimpan draf sekarang (storan penyegerakan penuh atau rantai kunci dikunci).',
  uwConflictOfflineDesktop:
    'Anda di luar talian dan versi terkini tiada pada komputer ini, jadi belum boleh dimuat semula.',
  uwConflictReloadDesktopBody:
    'Pilih apa yang berlaku kepada perubahan anda sebelum versi {n} dimuatkan.',
  uwConflictKeepDraft: 'Simpan versi saya sebagai draf',
  uwConflictDiscard: 'Buang perubahan saya',
  uwConflictKeepDraftHint:
    'Draf kekal di pusat penyegerakan untuk dilihat atau disalin; ia tidak sekali-kali digunakan pada versi baharu secara automatik.',
  uwConflictDraftCapReached:
    'Dokumen ini telah mencapai bilangan maksimum draf yang disimpan: {cap}. Buang draf lama di pusat penyegerakan untuk menyimpan yang lain.',

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

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'Simpanan terdahulu memerlukan sokongan, jadi anda belum boleh memuat semula atau menulis ganti. Buka pusat penyegerakan untuk menyelesaikannya.',
  uwRemoteRevoked:
    'Anda tidak lagi mempunyai akses kepada dokumen ini. Penyimpanan dihentikan; perubahan yang belum disimpan kekal dikunci pada komputer ini.',
} satisfies Record<keyof typeof zh, string>
