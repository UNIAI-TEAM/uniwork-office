import type { zh } from './zh'

export const id = {
  setRestoreSession: 'Buka kembali dokumen dari sesi terakhir',
  setRestoreSessionDesc:
    'Dokumen yang terbuka saat UniWork Office ditutup akan dibuka kembali secara otomatis saat dijalankan berikutnya.',
  setAutoUpdateCheck: 'Periksa pembaruan secara otomatis',
  setAutoUpdateCheckDesc:
    'Jika dimatikan, UniWork Office tidak lagi memeriksa versi baru saat dijalankan atau di latar belakang. Anda tetap bisa memeriksa dari Bantuan › Periksa Pembaruan.',
} satisfies Record<keyof typeof zh, string>
