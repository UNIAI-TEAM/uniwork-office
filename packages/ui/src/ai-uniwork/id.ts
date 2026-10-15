import type { zh } from './zh'

export const id = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Sisa {remaining} / {limit}',
  aiUniworkFooterSignIn: 'Masuk ke UniWork untuk memakai UniWork AI',
  aiUniworkSignedOut: 'Anda sudah keluar dari UniWork. Pilih penyedia lain atau masuk lagi.',
  aiUniworkOff: 'UniWork AI dinonaktifkan untuk dokumen ini. Pilih penyedia lain.',
  aiUniworkViewOnly:
    'Hanya lihat: AI dapat menjawab tetapi tidak dapat mengedit atau menyimpan dokumen.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI membaca apa yang terbuka di dokumen ini, termasuk perubahan yang belum disimpan, lalu mengirimkannya ke UniWork dan penyedia model untuk menjawab. Setiap proses memakai kredit AI {org}. AI tidak pernah menyimpan untuk Anda: tinjau, lalu tekan Simpan.',
  aiUniworkDisclosureLabel: 'Yang diterima UniWork AI',
  aiUniworkDisclosureShort:
    'Mengirim konten terbuka (termasuk yang belum disimpan) ke UniWork · kredit {org}',
  aiUniworkLocalFile:
    'File ini ada di komputer Anda, bukan di UniWork. Dengan UniWork AI, konten file yang terbuka dikirim ke UniWork dan memakai kredit AI {org}. File tidak diunggah sebagai dokumen UniWork.',
  aiUniworkAck: 'Mengerti',
  aiUniworkLearnMore: 'Pelajari lebih lanjut',
  aiUniworkDetails: 'Detail',
  aiUniworkSendNeedsAck: 'Baca dan konfirmasi pemberitahuan sebelum mengirim.',

  // S9 result chips and run controls
  aiResultAnswer: 'Jawaban',
  aiResultClarify: 'Perlu klarifikasi',
  aiResultEdited: 'Diedit di dokumen',
  aiResultUnsupported: 'Tidak didukung',
  aiResultError: 'Kesalahan',
  aiResultEditedHint:
    'Belum disimpan — urungkan dengan Ctrl/⌘+Z, atau tekan Simpan jika sudah sesuai.',
  aiResultViewChanges: 'Lihat perubahan',
  aiRunStop: 'Hentikan',
  aiRunSend: 'Kirim',
  aiRunRunning: 'Berjalan… Tekan Hentikan atau Esc untuk berhenti.',
  aiRunStopped:
    'Dihentikan. Perubahan yang sudah diterapkan tetap ada di dokumen dan dapat diurungkan.',
  aiRunAskAgain: 'Tanya lagi',
  aiRunChooseOther: 'Pilih penyedia lain',
  aiRunOpenInApp: 'Buka di aplikasi',
  aiConversationRestarted:
    'Percakapan sebelumnya kedaluwarsa, jadi UniWork AI memulai percakapan baru dan tidak lagi mengingat giliran sebelumnya. Kirim pertanyaan Anda lagi untuk melanjutkan.',
  aiConversationBoundary: 'Percakapan baru dengan {provider}: giliran di atas tidak ikut dikirim.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Proses ini mencapai batas langkah UniWork AI. Hasil sejauh ini tetap disimpan; pecah permintaan lalu tanya lagi.',
  aiErrCredits: 'Kredit AI organisasi Anda untuk periode ini sudah habis. Proses ini dihentikan.',
  aiErrEntitlement: 'Paket organisasi Anda tidak lagi mencakup UniWork AI.',
  aiErrRateLimited: 'Anda mengirim terlalu cepat. Coba lagi dalam {seconds} dtk.',
  aiErrRateLimitedNoWait: 'Anda mengirim terlalu cepat. Coba lagi dalam beberapa menit.',
  aiErrUnavailable: 'UniWork AI sedang tidak merespons. Dokumen Anda dan Simpan tetap berfungsi.',
  aiErrGeneric:
    'UniWork AI mengalami masalah tak terduga, jadi proses ini dihentikan. Dokumen Anda dan Simpan tetap berfungsi.',
  aiErrDisconnected:
    'Koneksi terputus, jadi proses ini dihentikan. Perubahan yang sudah diterapkan tetap ada di dokumen dan dapat diurungkan.',
  aiErrOffline:
    'Anda sedang offline. UniWork AI tidak berjalan secara offline dan permintaan tidak diantrekan.',
  aiErrSession:
    'Sesi UniWork Anda kedaluwarsa, jadi proses ini dihentikan. Masuk lagi untuk melanjutkan.',
  aiErrRevoked: 'Anda tidak lagi memiliki akses ke dokumen ini, jadi proses AI dihentikan.',
  aiErrDowngraded:
    'Akses Anda baru saja berubah menjadi hanya lihat, jadi AI berhenti mengedit. Jawaban tetap berlanjut.',
  aiErrCapabilityOff:
    'UniWork AI baru saja dinonaktifkan untuk dokumen ini, jadi proses berhenti setelah langkah saat ini.',
  aiErrUnsupported: 'UniWork AI belum dapat melakukan ini di {module}.',
  aiErrViewOnlyEdit:
    'Anda hanya memiliki akses lihat ke dokumen ini, jadi AI tidak dapat mengeditnya.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'Permintaan Anda terlalu panjang untuk UniWork AI. Persingkat menjadi kurang dari 8.000 karakter, lalu kirim lagi.',
  aiErrQuestionRejected:
    'UniWork AI tidak dapat menerima permintaan ini. Ubah permintaannya, lalu kirim lagi.',
  aiUniworkImagesNotSent: 'Gambar tidak dikirim ke UniWork AI; hanya teks Anda yang dikirim.',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
  cloudStateReady: 'Tersedia',
  cloudStateNotEntitled: 'Tidak termasuk dalam paket Anda',
  cloudStateExhausted: 'Kredit AI habis',
  cloudStateUnavailable: 'Tidak tersedia',
  cloudStateSignedOut: 'Belum masuk',
  cloudStateInactive: 'Langganan tidak aktif',
  cloudCredits: 'Kredit AI',
  cloudCreditsLeft: 'Sisa {remaining} / {limit}',
  cloudCreditsUnlimited: 'Tanpa batas',
  cloudCreditsRenews: 'Diperbarui {date}',
  cloudInactiveBody:
    'Langganan UniWork organisasi Anda tidak aktif, sehingga AI cloud dijeda. Minta admin untuk memperpanjangnya; penyedia Anda sendiri di bawah tetap berfungsi.',
  acctSignIn: 'Masuk',
  acctSignInAgain: 'Masuk lagi',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart:
    'File lokal memulai percakapan baru di bawah organisasi Anda dan tidak menyimpan giliran dari file lain.',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta: 'Sel ditulis: {written} ({range}) · Sel yang ada ditimpa: {overwritten}',
  aiResultCellsMetaNoOverwrite: 'Sel ditulis: {written} ({range})',
  aiErrWorkbookTooLarge:
    'Buku kerja ini terlalu besar untuk AI di web. Buka di aplikasi UniWork Office.',
  // S7 composer notice keys (not_entitled, credits_exhausted)
  not_entitled:
    'Paket organisasi Anda tidak mencakup UniWork AI. Tanyakan kepada admin organisasi tentang paket tersebut, atau tambahkan kunci AI Anda sendiri di Pengaturan > Model AI.',
  credits_exhausted:
    'Organisasi Anda telah menggunakan semua kredit AI untuk periode ini. Minta admin organisasi untuk menambahkan kredit, atau tambahkan kunci AI Anda sendiri di Pengaturan > Model AI.',
} satisfies Record<keyof typeof zh, string>
