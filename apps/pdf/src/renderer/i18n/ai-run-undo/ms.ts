import type { zh } from './zh'

export const ms = {
  aiRunUndo: 'Buat asal larian ini',
  aiRunUndoDone: 'Larian dibuat asal',
  aiRunUndoLater:
    'Ada perubahan selepas larian ini. Buat asal perubahan itu dahulu, kemudian buat asal larian ini.',
  aiRunUndoBusy: 'Tersedia selepas pembantu selesai.',
  aiEditsPaused:
    'Pembantu sedang mengedit dokumen ini. Suntingan anda dijeda; hentikan pembantu untuk meneruskan.',
} satisfies Record<keyof typeof zh, string>
