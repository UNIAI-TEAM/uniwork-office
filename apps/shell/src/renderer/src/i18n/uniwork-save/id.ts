import type { zh } from './zh'

export const id = {
  usMyFolder: 'Folder Saya',
  usPrivateTag: 'Pribadi',
  usDialogTitle: 'Beri nama dokumen',
  usHint:
    'Penyimpanan pertama. Penyimpanan berikutnya memakai nama ini; gunakan “Simpan sebagai” untuk mengubahnya.',
  usName: 'Nama',
  usLocation: 'Lokasi',
  usSavingIn: 'Menyimpan di: {folder}',
  usMyFolderPrivate: 'Pribadi, hanya Anda yang bisa melihat',
  usChange: 'Ubah',
  usSave: 'Simpan',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: 'Tutup',
  usPickTitle: 'Pilih lokasi simpan',
  usBack: 'Kembali ke penamaan',
  usSearchFolders: 'Cari folder',
  usChooseFolder: 'Pilih “{folder}”',
  usSelected: 'Dipilih',
  usRootBlocked: 'Pilih sebuah folder',
  usErrInvalidDestination: 'Tidak dapat menyimpan di sini. Pilih folder lain.',
  usErrMyFolderLocked:
    'Folder Saya adalah folder sistem pribadi Anda dan tidak dapat diganti nama, dibagikan, dipindahkan, atau diarsipkan.',
  usErrFlushFailed:
    'Dokumen belum dapat ditulis ke perangkat ini. Simpan dokumen terlebih dahulu, lalu coba lagi.',
  usErrBindFailed:
    '“{title}” (ID {id}) telah dibuat tetapi tidak dapat ditautkan ke tab ini. Dokumen dipindahkan ke tempat sampah dan dapat dipulihkan.',
  usErrOrphaned:
    '“{title}” (ID {id}) telah dibuat di UniWork tetapi tidak dapat ditautkan ke tab ini maupun dipindahkan ke tempat sampah. Hapus atau gunakan dokumen itu di UniWork.',
  usErrAlreadyBound: 'Tab ini sudah ditautkan ke dokumen UniWork. Simpan seperti biasa.',
  usErrNotFound:
    'File yang akan disimpan atau folder yang dipilih tidak ditemukan. Pilih lokasi simpan lagi, lalu coba lagi.',
  usShareToggle: 'Share with workspace',
  usShareHint: 'Everyone in this workspace can view this document',
  usShareAlready: 'Already shared with the workspace',
  usShareFailed: 'Could not share. Check the principal and the level.',
} satisfies Record<keyof typeof zh, string>
