import type { zh } from './zh'

export const ms = {
  usMyFolder: 'Folder Saya',
  usPrivateTag: 'Peribadi',
  usDialogTitle: 'Namakan dokumen',
  usHint:
    'Simpanan pertama. Simpanan seterusnya mengekalkan nama ini; gunakan “Simpan sebagai” untuk menukarnya.',
  usName: 'Nama',
  usLocation: 'Lokasi',
  usSavingIn: 'Menyimpan dalam: {folder}',
  usMyFolderPrivate: 'Peribadi, hanya anda yang boleh melihat',
  usChange: 'Tukar',
  usSave: 'Simpan',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: 'Tutup',
  usPickTitle: 'Pilih tempat simpan',
  usBack: 'Kembali ke penamaan',
  usSearchFolders: 'Cari folder',
  usChooseFolder: 'Pilih “{folder}”',
  usSelected: 'Dipilih',
  usRootBlocked: 'Pilih satu folder',
  usErrInvalidDestination: 'Tidak dapat menyimpan di sini. Pilih folder lain.',
  usErrMyFolderLocked:
    'Folder Saya ialah folder sistem peribadi anda dan tidak boleh dinamakan semula, dikongsi, dialihkan atau diarkibkan.',
  usErrFlushFailed:
    'Dokumen belum dapat ditulis ke peranti ini. Simpan dokumen dahulu, kemudian cuba lagi.',
  usErrBindFailed:
    '“{title}” (ID {id}) telah dicipta tetapi tidak dapat dipautkan ke tab ini. Dokumen telah dialihkan ke tong sampah dan boleh dipulihkan.',
  usErrOrphaned:
    '“{title}” (ID {id}) telah dicipta dalam UniWork tetapi tidak dapat dipautkan ke tab ini atau dialihkan ke tong sampah. Padam atau gunakan dokumen itu dalam UniWork.',
  usErrAlreadyBound: 'Tab ini sudah dipautkan kepada dokumen UniWork. Simpan seperti biasa.',
  usErrNotFound:
    'Fail untuk disimpan atau folder yang dipilih tidak ditemui. Pilih tempat simpan sekali lagi, kemudian cuba semula.',
} satisfies Record<keyof typeof zh, string>
