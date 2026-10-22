import type { zh } from './zh'

export const ms = {
  algMenu: 'Log akses',
  algTitle: 'Log akses',
  algDescription:
    'Siapa yang melihat, memuat turun atau membuka dokumen melalui pautan. Hanya pengurus boleh membacanya.',
  algManageOnly: 'Anda memerlukan akses pengurusan untuk membaca log akses.',
  algLoading: 'Memuatkan log…',
  algError: 'Tidak dapat memuatkan log akses.',
  algEmpty: 'Belum ada akses direkodkan.',
  algFilterLabel: 'Tindakan',
  algFilterAll: 'Semua tindakan',
  algActionView: 'Lihat',
  algActionDownload: 'Muat turun',
  algActionExport: 'Eksport',
  algActionLinkView: 'Dibuka melalui pautan',
  algActionUnknown: 'Lain-lain',
  algActorAnonymous: 'Tanpa nama',
  algActorSystem: 'Sistem',
  algActorUnknown: 'Tidak diketahui',
  algVersion: 'versi {no}',
} satisfies Record<keyof typeof zh, string>
