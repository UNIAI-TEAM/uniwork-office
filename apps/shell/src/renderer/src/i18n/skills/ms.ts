import type { zh } from './zh'

export const ms = {
  setSecSkills: 'Kemahiran',
  intgSkillsDesc:
    'UniWork Office hanya menggunakan kemahiran dalam folder kemahirannya sendiri. Mengimport folder atau zip menyalin keseluruhan kemahiran; tiada apa yang dijalankan semasa import.',
  intgSkillsEmpty: 'Belum ada kemahiran dipasang.',
  intgSkillsImportFolder: 'Import folder…',
  intgSkillsImportZip: 'Import pakej kemahiran (zip / .md)…',
  intgSkillsImportFolderTitle: 'Pilih folder kemahiran',
  intgSkillsImportZipTitle: 'Pilih zip atau .md kemahiran',
  intgSkillsImportDone: '{name} diimport',
  intgSkillsImportFailed: 'Import gagal: {reason}',
  intgSkillsRemove: 'Buang',
  intgSkillsRemoveConfirm:
    'Buang kemahiran "{name}"? Foldernya akan dipadam daripada UniWork Office.',
  intgSkillsRemoved: '{name} dibuang',
  intgSkillsRead: 'Detail',
  intgSkillsMine: 'Kemahiran saya',
  intgSkillsRecommended: 'Disyorkan',
  intgSkillsCatOffice: 'Pejabat',
  intgSkillsCatBusiness: 'Perniagaan',
  intgSkillsCatData: 'Data',
  intgSkillsCatFinance: 'Kewangan',
  intgSkillsCatHr: 'Sumber manusia',
  intgSkillsCatLegal: 'Undang-undang',
  intgSkillsCatMarketing: 'Pemasaran',
  intgSkillsCatEducation: 'Pendidikan',
  intgSkillsCatOther: 'Lain-lain',
  intgSkillsInstall: 'Pasang',
  intgSkillsUpdate: 'Kemas kini',
  intgSkillsInstalledTag: 'Dipasang',
} satisfies Record<keyof typeof zh, string>
