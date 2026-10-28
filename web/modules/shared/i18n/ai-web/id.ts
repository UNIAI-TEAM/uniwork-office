import type { zh } from './zh'

export const id = {
  aiWebSettingsTitle: 'Pengaturan AI',
  aiWebSettingsIntro:
    'Asisten memakai kunci API penyedia milik Anda sendiri. UniWork menyimpannya dalam bentuk terenkripsi; kunci tidak pernah dikirim ke halaman ini.',
  aiWebProvider: 'Penyedia',
  aiWebModel: 'Model',
  aiWebKeySaved: 'Kunci tersimpan {hint}',
  aiWebNoKey: 'Belum ada kunci tersimpan',
  aiWebApiKey: 'Kunci API',
  aiWebApiKeyKeep: 'Kunci API baru (kosongkan untuk mempertahankan yang tersimpan)',
  aiWebBaseUrl: 'URL dasar',
  aiWebSaveKey: 'Simpan kunci',
  aiWebRemoveKey: 'Hapus kunci',
  aiWebDone: 'Selesai',
  aiWebLoading: 'Memuat…',
  aiWebLoadFailed: 'Pengaturan AI tidak dapat dimuat. Coba lagi nanti.',
  aiWebCloudTitle: 'Alat cloud UniWork AI',
  aiWebCloudOff: 'Tidak termasuk dalam paket organisasi Anda',
  aiWebCredits: 'Sisa kredit: {remaining} dari {limit}',
  aiWebCreditsUnlimited: 'Kredit: tanpa batas',
  aiWebCreditsRenew: 'Diperbarui pada {date}',
  aiWebOpenSettings: 'Pengaturan AI',
  aiWebClose: 'Tutup',
  aiWebStateCreditsTitle: 'Kredit AI habis',
  aiWebStateCreditsBody:
    'Organisasi Anda telah memakai semua kredit UniWork AI periode ini. Hubungi administrator atau tunggu pembaruan.',
  aiWebStateEntitlementTitle: 'AI tidak ada di paket Anda',
  aiWebStateEntitlementBody:
    'Paket UniWork organisasi Anda tidak mencakup fitur AI ini. Hubungi administrator.',
  aiWebStateKeyMissingTitle: 'Belum ada kunci AI',
  aiWebStateKeyMissingBody: 'Tambahkan kunci API di pengaturan AI untuk memakai asisten.',
  aiWebStateKeyRejectedTitle: 'Kunci AI ditolak',
  aiWebStateKeyRejectedBody: 'Penyedia menolak kunci tersimpan. Ganti kunci di Pengaturan AI.',
  aiWebStateRateTitle: 'Terlalu banyak permintaan AI',
  aiWebStateRateBody: 'Tunggu {seconds} detik lalu coba lagi.',
  aiWebStateRateBodyNow: 'Tunggu sebentar lalu coba lagi.',
  aiWebStateUnreachableTitle: 'Penyedia AI tidak terjangkau',
  aiWebStateUnreachableBody: 'UniWork tidak dapat menjangkau penyedia AI. Coba lagi sebentar lagi.',
  aiWebStateCloudTitle: 'Alat cloud tidak tersedia',
  aiWebStateCloudBody: 'Alat UniWork AI ini belum disiapkan di server.',
  aiWebStateOutageTitle: 'UniWork sementara tidak tersedia',
  aiWebStateOutageBody: 'UniWork tidak dapat dijangkau saat ini. Coba lagi sebentar lagi.',
  aiWebStateSessionTitle: 'Sesi kedaluwarsa',
  aiWebStateSessionBody: 'Buka kembali dokumen dari UniWork untuk melanjutkan.',
  aiWebStateRefusedTitle: 'Permintaan ditolak',
  aiWebStateRefusedBody: 'Server menolak permintaan AI.',
  aiWebStateModelTitle: 'Pilih model',
  aiWebStateModelBody: 'Pilih model di menu model di samping kotak pesan, lalu kirim lagi.',
  aiWebStateBaseUrlBody: 'URL dasar ini tidak diizinkan. Gunakan alamat https:// publik.',
  aiWebStateProviderBody: 'Penyedia ini tidak didukung.',
  aiWebStateUnknownTitle: 'Permintaan AI gagal',
  aiWebStateUnknownBody: 'Terjadi kesalahan. Coba lagi.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Buku kerja ini terlalu besar untuk AI di web. Buka di aplikasi UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Lanjutkan ke bagian berikutnya.',
} satisfies Record<keyof typeof zh, string>
