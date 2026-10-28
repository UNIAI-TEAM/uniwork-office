import type { zh } from './zh'

export const nl = {
  setSecSkills: 'Vaardigheden',
  intgSkillsDesc:
    'UniWork Office gebruikt alleen vaardigheden uit zijn eigen map. Een map of zip importeren kopieert de hele vaardigheid; bij het importeren wordt niets uitgevoerd.',
  intgSkillsEmpty: 'Nog geen vaardigheden geïnstalleerd.',
  intgSkillsImportFolder: 'Map importeren…',
  intgSkillsImportZip: 'Vaardigheidspakket importeren (zip / .md)…',
  intgSkillsImportFolderTitle: 'Kies een vaardigheidsmap',
  intgSkillsImportZipTitle: 'Kies een zip of .md van een vaardigheid',
  intgSkillsImportDone: '{name} geïmporteerd',
  intgSkillsImportFailed: 'Importeren mislukt: {reason}',
  intgSkillsRemove: 'Verwijderen',
  intgSkillsRemoveConfirm:
    'Vaardigheid "{name}" verwijderen? De map wordt uit UniWork Office verwijderd.',
  intgSkillsRemoved: '{name} verwijderd',
  intgSkillsRead: 'Details',
  intgSkillsMine: 'Mijn vaardigheden',
  intgSkillsRecommended: 'Aanbevolen',
  intgSkillsCatOffice: 'Kantoor',
  intgSkillsCatBusiness: 'Zakelijk',
  intgSkillsCatData: 'Data',
  intgSkillsCatFinance: 'Financiën',
  intgSkillsCatHr: 'HR',
  intgSkillsCatLegal: 'Juridisch',
  intgSkillsCatMarketing: 'Marketing',
  intgSkillsCatEducation: 'Onderwijs',
  intgSkillsCatOther: 'Overig',
  intgSkillsInstall: 'Installeren',
  intgSkillsUpdate: 'Bijwerken',
  intgSkillsInstalledTag: 'Geïnstalleerd',
} satisfies Record<keyof typeof zh, string>
