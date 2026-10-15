import type { zh } from './zh'

export const id = {
  aiRunUndo: 'Urungkan proses ini',
  aiRunUndoDone: 'Proses diurungkan',
  aiRunUndoLater:
    'Ada perubahan setelah proses ini. Urungkan perubahan itu dulu, baru urungkan proses ini.',
  aiRunUndoBusy: 'Tersedia setelah asisten selesai.',
} satisfies Record<keyof typeof zh, string>
