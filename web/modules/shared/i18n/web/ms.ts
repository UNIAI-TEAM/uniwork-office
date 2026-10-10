import type { zh } from './zh'

export const ms = {
  webCancel: 'Batal',
  webConflictTitle: 'Dokumen ini telah diubah di tempat lain',
  webConflictBody:
    'Versi yang lebih baharu telah disimpan semasa anda menyunting. Tulis ganti dengan versi anda, atau muat semula versi terkini dan buang perubahan anda?',
  webConflictOverwrite: 'Tulis ganti',
  webConflictReload: 'Muat semula versi terkini',
  webConflictNotSaved: 'dokumen telah diubah di tempat lain',
  webFatalTitle: 'Dokumen tidak dapat dibuka',
  webFatalBody:
    'Penyuntingan dan penyimpanan dilumpuhkan. Muat semula halaman atau buka semula dokumen daripada UniWork.',
  webNoHost: 'Editor ini berjalan di dalam UniWork. Buka dokumen daripada UniWork.',
  webViewOnly: 'Lihat sahaja',
  webViewOnlyNotSaved: 'Dokumen ini untuk dilihat sahaja dan tidak boleh disimpan',
  webNotUtf8:
    'Fail ini bukan teks UTF-8. Ia dibuka untuk dilihat sahaja supaya simpanan tidak mengubah kandungannya',
  webDraftTitle: 'Pulihkan perubahan yang belum disimpan?',
  webDraftBody:
    'Pelayar ini menyimpan salinan perubahan pada dokumen ini yang belum disimpan. Pulihkan atau buang?',
  webDraftOlder:
    'Salinan ini berdasarkan versi dokumen yang lebih lama. Menyimpannya akan menggantikan versi yang lebih baharu.',
  webDraftSavedAt: 'Salinan disimpan pada',
  webDraftKept: 'Pelayar ini menyimpan salinan sehingga anda log keluar.',
  webDraftRestore: 'Pulihkan',
  webDraftDiscard: 'Buang',
  webSaveNetwork: 'UniWork tidak dapat dicapai. Semak sambungan anda dan cuba lagi.',
  webSaveTimeout: 'Penyimpanan mengambil masa terlalu lama. Semak sambungan anda dan cuba lagi.',
  webClose: 'Tutup',
  webSaveUnauthorized:
    'Sesi UniWork anda telah tamat. Log masuk semula, kemudian cuba simpan lagi.',
  webSaveForbidden: 'Anda tiada kebenaran untuk menyimpan dokumen ini.',
  webSaveNotFound: 'Dokumen ini sudah tiada atau telah dialihkan.',
  webSaveTooLarge: 'Dokumen terlalu besar untuk disimpan.',
  webSaveRateLimited: 'Terlalu banyak permintaan. Tunggu sebentar dan cuba lagi.',
  webSaveServer: 'UniWork menghadapi masalah semasa menyimpan. Cuba lagi sebentar lagi.',
  webSaveFailedGeneric: 'Dokumen tidak dapat disimpan. Cuba lagi.',
} satisfies Record<keyof typeof zh, string>
