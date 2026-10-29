import type { zh } from './zh'

export const de = {
  setSecSkills: 'Skills',
  intgSkillsDesc:
    'UniWork Office verwendet nur Skills aus seinem eigenen Skills-Ordner. Der Import eines Ordners oder einer ZIP kopiert den ganzen Skill; beim Import wird nichts ausgeführt.',
  intgSkillsEmpty: 'Noch keine Skills installiert.',
  intgSkillsImportFolder: 'Ordner importieren…',
  intgSkillsImportZip: 'Skill-Paket importieren (ZIP / .md)…',
  intgSkillsImportFolderTitle: 'Skill-Ordner wählen',
  intgSkillsImportZipTitle: 'Skill-ZIP oder .md wählen',
  intgSkillsImportDone: '{name} importiert',
  intgSkillsImportFailed: 'Import fehlgeschlagen: {reason}',
  intgSkillsRemove: 'Entfernen',
  intgSkillsRemoveConfirm:
    'Skill „{name}“ entfernen? Sein Ordner wird aus UniWork Office gelöscht.',
  intgSkillsRemoved: '{name} entfernt',
  intgSkillsRead: 'Details',
  intgSkillsMine: 'Meine Skills',
  intgSkillsRecommended: 'Empfohlen',
  intgSkillsCatOffice: 'Büro',
  intgSkillsCatBusiness: 'Business',
  intgSkillsCatData: 'Daten',
  intgSkillsCatFinance: 'Finanzen',
  intgSkillsCatHr: 'Personal',
  intgSkillsCatLegal: 'Recht',
  intgSkillsCatMarketing: 'Marketing',
  intgSkillsCatEducation: 'Bildung',
  intgSkillsCatOther: 'Sonstiges',
  intgSkillsInstall: 'Installieren',
  intgSkillsUpdate: 'Aktualisieren',
  intgSkillsInstalledTag: 'Installiert',
} satisfies Record<keyof typeof zh, string>
