import type { zh } from './zh'

export const id = {
  algMenu: 'Log akses',
  algTitle: 'Log akses',
  algDescription:
    'Siapa yang melihat, mengunduh, atau membuka dokumen melalui tautan. Hanya pengelola yang dapat membacanya.',
  algManageOnly: 'Anda memerlukan akses kelola untuk membaca log akses.',
  algLoading: 'Memuat log…',
  algError: 'Tidak dapat memuat log akses.',
  algEmpty: 'Belum ada akses yang tercatat.',
  algFilterLabel: 'Tindakan',
  algFilterAll: 'Semua tindakan',
  algActionView: 'Lihat',
  algActionDownload: 'Unduh',
  algActionExport: 'Ekspor',
  algActionLinkView: 'Dibuka lewat tautan',
  algActionUnknown: 'Lainnya',
  algActorAnonymous: 'Anonim',
  algActorSystem: 'Sistem',
  algActorUnknown: 'Tidak diketahui',
  algVersion: 'versi {no}',
} satisfies Record<keyof typeof zh, string>
