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
  intgSkillsErrDirUnreadable: 'nie udało się odczytać folderu umiejętności',
  intgSkillsErrDirSymlink:
    'folder umiejętności jest dowiązaniem symbolicznym, których import nie obsługuje',
  intgSkillsErrContainsSymlink:
    'umiejętność zawiera dowiązanie symboliczne, których import nie obsługuje',
  intgSkillsErrTooLarge: 'umiejętność przekracza limit importu 10 MB',
  intgSkillsErrReadBackFailed: 'nie udało się ponownie odczytać umiejętności',
  intgSkillsErrMissingSkillMd: 'w folderze brak pliku SKILL.md',
  intgSkillsErrInvalidFrontmatter:
    'plik SKILL.md wymaga pól name i description w nagłówku frontmatter',
  intgSkillsErrInvalidFolderName: 'nazwa folderu nie może być użyta jako nazwa umiejętności',
  intgSkillsErrAlreadyExists: 'umiejętność o tej nazwie już istnieje',
  intgSkillsErrFileUnreadable: 'nie udało się odczytać pliku',
  intgSkillsErrInvalidFileName: 'nazwa pliku nie może być użyta jako nazwa umiejętności',
  intgSkillsErrNotZip: 'plik nie jest archiwum zip',
  intgSkillsErrTooManyEntries: 'archiwum przekracza limit importu wynoszący {max} pozycji',
  intgSkillsErrUnsafeEntry: 'archiwum zawiera niebezpieczną nazwę pozycji: {name}',
  intgSkillsErrArchiveSymlink:
    'archiwum zawiera dowiązanie symboliczne, których import nie obsługuje',
  intgSkillsErrArchiveMissingSkillMd:
    'archiwum nie zawiera pliku SKILL.md w katalogu głównym ani w pojedynczym folderze',
  intgSkillsErrInvalidArchiveName: 'nazwa archiwum nie może być użyta jako nazwa umiejętności',
  intgSkillsErrUnknownSkill: 'nieznana umiejętność',
  intgSkillsErrUnknownTarget: 'nieznany cel umiejętności',
} satisfies Record<keyof typeof zh, string>
