import type { zh } from './zh'

export const id = {
  aiRunUndo: 'Urungkan proses ini',
  aiRunUndoDone: 'Proses diurungkan',
  aiRunUndoLater:
    'Ada perubahan setelah proses ini. Urungkan perubahan itu dulu, baru urungkan proses ini.',
  aiRunUndoBusy: 'Tersedia setelah asisten selesai.',
  aiEditsPaused:
    'Asisten sedang mengerjakan dokumen ini. Suntingan Anda dijeda; hentikan asisten untuk melanjutkan.',
} satisfies Record<keyof typeof zh, string>
