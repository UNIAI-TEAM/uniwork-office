import type { zh } from './zh'

export const ms = {
  webConflictTitle: 'Persembahan ini telah diubah di tempat lain',
  webConflictBody:
    'Seseorang telah menyimpan versi yang lebih baharu. Tulis ganti menggantikannya dengan perubahan anda; Muat semula terkini membuang perubahan anda dan membuka versi terkini.',
  webConflictOverwrite: 'Tulis ganti',
  webConflictReload: 'Muat semula terkini',
  webConflictNotSaved: 'persembahan telah diubah di tempat lain',
  webDiscardTitle: 'Buang perubahan yang belum disimpan?',
  webDiscardBody:
    'Persembahan ini mempunyai perubahan yang belum disimpan. Membuka fail lain akan menghilangkannya.',
  webDiscard: 'Buang dan buka',
  webCancel: 'Batal',
  webOk: 'OK',
  webFatalTitle: 'Persembahan tidak dapat dibuka',
  webFatalBody: 'Fail tidak dapat dimuatkan daripada UniWork. Tutup tab ini dan cuba lagi.',
  webNoHost: 'Editor ini berjalan di dalam UniWork. Buka persembahan daripada UniWork.',
  webLegacyPpt:
    'Ini fail .ppt lama dan tidak boleh dibuka dalam pelayar. Simpan sebagai .pptx dalam PowerPoint dahulu.',
  webEncryptedPptx: 'Persembahan ini dilindungi kata laluan dan tidak boleh dibuka dalam pelayar.',
  webCommentAuthor: 'Pengguna',
  webExternalMedia: 'Media luaran yang dipautkan hanya dimainkan dalam aplikasi desktop.',
  webReadOnly: 'Persembahan ini baca sahaja.',
  webSaveNetwork: 'UniWork tidak dapat dicapai. Semak sambungan anda dan cuba lagi.',
  webSaveTimeout: 'Penyimpanan mengambil masa terlalu lama. Semak sambungan anda dan cuba lagi.',
} satisfies Record<keyof typeof zh, string>
