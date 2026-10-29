import type { zh } from './zh'

export const id = {
  setSecSkills: 'Keterampilan',
  intgSkillsDesc:
    'UniWork Office hanya memakai keterampilan di folder keterampilannya sendiri. Mengimpor folder atau zip menyalin seluruh keterampilan; tidak ada yang dijalankan saat impor.',
  intgSkillsEmpty: 'Belum ada keterampilan terpasang.',
  intgSkillsImportFolder: 'Impor folder…',
  intgSkillsImportZip: 'Impor paket keterampilan (zip / .md)…',
  intgSkillsImportFolderTitle: 'Pilih folder keterampilan',
  intgSkillsImportZipTitle: 'Pilih zip atau .md keterampilan',
  intgSkillsImportDone: '{name} diimpor',
  intgSkillsImportFailed: 'Impor gagal: {reason}',
  intgSkillsRemove: 'Hapus',
  intgSkillsRemoveConfirm:
    'Hapus keterampilan "{name}"? Foldernya akan dihapus dari UniWork Office.',
  intgSkillsRemoved: '{name} dihapus',
  intgSkillsRead: 'Detail',
  intgSkillsMine: 'Skill saya',
  intgSkillsRecommended: 'Disarankan',
  intgSkillsCatOffice: 'Perkantoran',
  intgSkillsCatBusiness: 'Bisnis',
  intgSkillsCatData: 'Data',
  intgSkillsCatFinance: 'Keuangan',
  intgSkillsCatHr: 'SDM',
  intgSkillsCatLegal: 'Hukum',
  intgSkillsCatMarketing: 'Pemasaran',
  intgSkillsCatEducation: 'Pendidikan',
  intgSkillsCatOther: 'Lainnya',
  intgSkillsInstall: 'Pasang',
  intgSkillsUpdate: 'Perbarui',
  intgSkillsInstalledTag: 'Terpasang',
} satisfies Record<keyof typeof zh, string>
