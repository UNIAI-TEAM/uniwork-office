import type { zh } from './zh'

export const ms = {
  aiWebClose: 'Tutup',
  aiWebStateCreditsTitle: 'Kredit AI telah habis',
  aiWebStateCreditsBody:
    'Organisasi anda telah menggunakan semua kredit UniWork AI bagi tempoh ini. Hubungi pentadbir atau tunggu sehingga diperbaharui.',
  aiWebStateEntitlementTitle: 'AI tiada dalam pelan anda',
  aiWebStateEntitlementBody:
    'Pelan UniWork organisasi anda tidak merangkumi ciri AI ini. Hubungi pentadbir.',
  aiWebStateRateTitle: 'Terlalu banyak permintaan AI',
  aiWebStateRateBody: 'Tunggu {seconds} saat dan cuba lagi.',
  aiWebStateRateBodyNow: 'Tunggu sebentar dan cuba lagi.',
  aiWebStateUnreachableTitle: 'Pembekal AI tidak dapat dihubungi',
  aiWebStateUnreachableBody:
    'UniWork tidak dapat menghubungi pembekal AI. Cuba lagi sebentar nanti.',
  aiWebStateCloudTitle: 'Alat awan tidak tersedia',
  aiWebStateCloudBody: 'Alat UniWork AI ini belum disediakan pada pelayan.',
  aiWebStateOutageTitle: 'UniWork tidak tersedia buat sementara',
  aiWebStateOutageBody: 'UniWork tidak dapat dihubungi sekarang. Cuba lagi sebentar nanti.',
  aiWebStateSessionTitle: 'Sesi tamat tempoh',
  aiWebStateSessionBody: 'Buka semula dokumen daripada UniWork untuk meneruskan.',
  aiWebStateRefusedTitle: 'Permintaan ditolak',
  aiWebStateRefusedBody: 'Pelayan menolak permintaan AI.',
  aiWebStateUnknownTitle: 'Permintaan AI gagal',
  aiWebStateUnknownBody: 'Sesuatu tidak kena. Cuba lagi.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Buku kerja ini terlalu besar untuk AI di web. Buka dalam apl UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Teruskan dengan bahagian seterusnya.',
} satisfies Record<keyof typeof zh, string>
