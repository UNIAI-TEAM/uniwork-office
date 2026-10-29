import type { zh } from './zh'

export const id = {
  aiWebClose: 'Tutup',
  aiWebStateCreditsTitle: 'Kredit AI habis',
  aiWebStateCreditsBody:
    'Organisasi Anda telah memakai semua kredit UniWork AI periode ini. Hubungi administrator atau tunggu pembaruan.',
  aiWebStateEntitlementTitle: 'AI tidak ada di paket Anda',
  aiWebStateEntitlementBody:
    'Paket UniWork organisasi Anda tidak mencakup fitur AI ini. Hubungi administrator.',
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
  aiWebStateUnknownTitle: 'Permintaan AI gagal',
  aiWebStateUnknownBody: 'Terjadi kesalahan. Coba lagi.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Buku kerja ini terlalu besar untuk AI di web. Buka di aplikasi UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Lanjutkan ke bagian berikutnya.',
} satisfies Record<keyof typeof zh, string>
