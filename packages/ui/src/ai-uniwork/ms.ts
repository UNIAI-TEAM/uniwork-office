import type { zh } from './zh'

export const ms = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Baki kredit: {remaining} daripada {limit}',
  aiUniworkFooterSignIn: 'Log masuk ke UniWork untuk menggunakan UniWork AI',
  aiUniworkSignedOut:
    'Anda telah log keluar daripada UniWork. Pilih penyedia lain atau log masuk semula.',
  aiUniworkOff: 'UniWork AI dimatikan untuk dokumen ini. Pilih penyedia lain.',
  aiUniworkViewOnly:
    'Lihat sahaja: AI boleh menjawab tetapi tidak boleh menyunting atau menyimpan dokumen.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI membaca apa yang dibuka dalam dokumen ini, termasuk perubahan yang belum disimpan, dan menghantarnya ke UniWork serta penyedia model untuk menjawab. Setiap larian menggunakan kredit AI {org}. AI tidak sekali-kali menyimpan untuk anda: semak, kemudian tekan Simpan.',
  aiUniworkDisclosureLabel: 'Apa yang diterima UniWork AI',
  aiUniworkDisclosureShort:
    'Menghantar kandungan terbuka (termasuk yang belum disimpan) ke UniWork · kredit {org}',
  aiUniworkLocalFile:
    'Fail ini berada pada komputer anda, bukan dalam UniWork. Dengan UniWork AI, kandungan fail yang dibuka dihantar ke UniWork dan menggunakan kredit AI {org}. Fail tidak dimuat naik sebagai dokumen UniWork.',
  aiUniworkAck: 'Faham',
  aiUniworkLearnMore: 'Ketahui lebih lanjut',
  aiUniworkDetails: 'Butiran',
  aiUniworkSendNeedsAck: 'Baca dan sahkan notis sebelum menghantar.',

  // S9 result chips and run controls
  aiResultAnswer: 'Jawapan',
  aiResultClarify: 'Perlu penjelasan',
  aiResultEdited: 'Disunting dalam dokumen',
  aiResultUnsupported: 'Tidak disokong',
  aiResultError: 'Ralat',
  aiResultEditedHint:
    'Belum disimpan — buat asal dengan Ctrl/⌘+Z, atau tekan Simpan apabila sudah betul.',
  aiResultViewChanges: 'Lihat perubahan',
  aiRunStop: 'Henti',
  aiRunSend: 'Hantar',
  aiRunRunning: 'Sedang berjalan… Tekan Henti atau Esc untuk berhenti.',
  aiRunStopped:
    'Dihentikan. Sebarang perubahan yang telah digunakan kekal dalam dokumen dan boleh dibuat asal.',
  aiRunAskAgain: 'Tanya lagi',
  aiRunChooseOther: 'Pilih penyedia lain',
  aiRunOpenInApp: 'Buka dalam apl',
  aiConversationRestarted:
    'Perbualan sebelumnya telah tamat tempoh, jadi UniWork AI memulakan perbualan baharu dan tidak lagi mengingati giliran terdahulu. Hantar soalan anda semula untuk meneruskan.',
  aiConversationBoundary:
    'Perbualan baharu dengan {provider}: giliran di atas tidak dihantar bersama.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Larian ini mencapai had langkah UniWork AI. Hasil setakat ini dikekalkan; pecahkan permintaan dan tanya lagi.',
  aiErrCredits: 'Kredit AI organisasi anda untuk tempoh ini telah habis. Larian ini dihentikan.',
  aiErrEntitlement: 'Pelan organisasi anda tidak lagi termasuk UniWork AI.',
  aiErrRateLimited: 'Anda menghantar terlalu pantas. Cuba lagi dalam {seconds} saat.',
  aiErrRateLimitedNoWait: 'Anda menghantar terlalu pantas. Cuba lagi dalam beberapa minit.',
  aiErrUnavailable:
    'UniWork AI tidak bertindak balas sekarang. Dokumen anda dan Simpan masih berfungsi.',
  aiErrDisconnected:
    'Sambungan terputus, jadi larian ini dihentikan. Sebarang perubahan yang telah digunakan kekal dalam dokumen dan boleh dibuat asal.',
  aiErrOffline:
    'Anda di luar talian. UniWork AI tidak berjalan di luar talian dan permintaan tidak dibariskan.',
  aiErrSession:
    'Sesi UniWork anda telah tamat tempoh, jadi larian ini dihentikan. Log masuk semula untuk meneruskan.',
  aiErrRevoked: 'Anda tidak lagi mempunyai akses kepada dokumen ini, jadi larian AI dihentikan.',
  aiErrDowngraded:
    'Akses anda baru sahaja bertukar kepada lihat sahaja, jadi AI berhenti menyunting. Jawapan diteruskan.',
  aiErrCapabilityOff:
    'UniWork AI baru sahaja dimatikan untuk dokumen ini, jadi larian berhenti selepas langkah semasa.',
  aiErrUnsupported: 'UniWork AI belum boleh melakukan ini dalam {module}.',
  aiErrViewOnlyEdit:
    'Anda hanya mempunyai akses lihat kepada dokumen ini, jadi AI tidak boleh menyuntingnya.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'Permintaan anda terlalu panjang untuk UniWork AI. Pendekkan kepada kurang daripada 8,000 aksara, kemudian hantar semula.',
  aiErrQuestionRejected:
    'UniWork AI tidak dapat menerima permintaan ini. Ubah permintaan itu, kemudian hantar semula.',
  aiUniworkImagesNotSent: 'Imej tidak dihantar kepada UniWork AI; hanya teks anda dihantar.',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
  cloudStateReady: 'Tersedia',
  cloudStateNotEntitled: 'Tiada dalam pelan anda',
  cloudStateExhausted: 'Kredit AI habis',
  cloudStateUnavailable: 'Tidak tersedia',
  cloudStateSignedOut: 'Belum log masuk',
  cloudStateInactive: 'Langganan tidak aktif',
  cloudCredits: 'Kredit AI',
  cloudCreditsLeft: 'Baki {remaining} / {limit}',
  cloudCreditsUnlimited: 'Tanpa had',
  cloudCreditsRenews: 'Diperbaharui {date}',
  cloudInactiveBody: 'Langganan UniWork organisasi anda tidak aktif, jadi AI awan dijeda. Minta pentadbir memperbaharuinya; pembekal anda sendiri di bawah terus berfungsi.',
  acctSignIn: 'Log masuk',
  acctSignInAgain: 'Log masuk semula',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart: 'Fail setempat memulakan perbualan baharu di bawah organisasi anda dan tidak menyimpan giliran daripada fail lain.',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta: 'Sel ditulis: {written} ({range}) · Sel sedia ada ditulis ganti: {overwritten}',
  aiErrWorkbookTooLarge: 'Buku kerja ini terlalu besar untuk AI di web. Buka dalam apl UniWork Office.',
} satisfies Record<keyof typeof zh, string>
