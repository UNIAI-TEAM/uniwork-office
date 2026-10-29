import type { zh } from './zh'

export const pl = {
  setSecSkills: 'Umiejętności',
  intgSkillsDesc:
    'UniWork Office używa tylko umiejętności z własnego folderu. Import folderu lub pliku zip kopiuje całą umiejętność; podczas importu nic nie jest uruchamiane.',
  intgSkillsEmpty: 'Brak zainstalowanych umiejętności.',
  intgSkillsImportFolder: 'Importuj folder…',
  intgSkillsImportZip: 'Importuj pakiet umiejętności (zip / .md)…',
  intgSkillsImportFolderTitle: 'Wybierz folder umiejętności',
  intgSkillsImportZipTitle: 'Wybierz plik zip lub .md umiejętności',
  intgSkillsImportDone: 'Zaimportowano {name}',
  intgSkillsImportFailed: 'Import nie powiódł się: {reason}',
  intgSkillsRemove: 'Usuń',
  intgSkillsRemoveConfirm:
    'Usunąć umiejętność „{name}”? Jej folder zostanie usunięty z UniWork Office.',
  intgSkillsRemoved: 'Usunięto {name}',
  intgSkillsRead: 'Szczegóły',
  intgSkillsMine: 'Moje umiejętności',
  intgSkillsRecommended: 'Polecane',
  intgSkillsCatOffice: 'Biuro',
  intgSkillsCatBusiness: 'Biznes',
  intgSkillsCatData: 'Dane',
  intgSkillsCatFinance: 'Finanse',
  intgSkillsCatHr: 'HR',
  intgSkillsCatLegal: 'Prawo',
  intgSkillsCatMarketing: 'Marketing',
  intgSkillsCatEducation: 'Edukacja',
  intgSkillsCatOther: 'Inne',
  intgSkillsInstall: 'Zainstaluj',
  intgSkillsUpdate: 'Aktualizuj',
  intgSkillsInstalledTag: 'Zainstalowana',
} satisfies Record<keyof typeof zh, string>
