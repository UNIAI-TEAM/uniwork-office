import type { zh } from './zh'

export const fr = {
  setSecSkills: 'Compétences',
  intgSkillsDesc:
    'UniWork Office n’utilise que les compétences de son propre dossier. Importer un dossier ou un zip copie toute la compétence ; rien ne s’exécute à l’import.',
  intgSkillsEmpty: 'Aucune compétence installée.',
  intgSkillsImportFolder: 'Importer un dossier…',
  intgSkillsImportZip: 'Importer un paquet de compétence (zip / .md)…',
  intgSkillsImportFolderTitle: 'Choisir un dossier de compétence',
  intgSkillsImportZipTitle: 'Choisir un zip ou un .md de compétence',
  intgSkillsImportDone: '{name} importée',
  intgSkillsImportFailed: 'Échec de l’import : {reason}',
  intgSkillsRemove: 'Supprimer',
  intgSkillsRemoveConfirm:
    'Supprimer la compétence « {name} » ? Son dossier sera supprimé de UniWork Office.',
  intgSkillsRemoved: '{name} supprimée',
  intgSkillsRead: 'Détails',
  intgSkillsMine: 'Mes compétences',
  intgSkillsRecommended: 'Recommandées',
  intgSkillsCatOffice: 'Bureau',
  intgSkillsCatBusiness: 'Entreprise',
  intgSkillsCatData: 'Données',
  intgSkillsCatFinance: 'Finance',
  intgSkillsCatHr: 'RH',
  intgSkillsCatLegal: 'Juridique',
  intgSkillsCatMarketing: 'Marketing',
  intgSkillsCatEducation: 'Éducation',
  intgSkillsCatOther: 'Autre',
  intgSkillsInstall: 'Installer',
  intgSkillsUpdate: 'Mettre à jour',
  intgSkillsInstalledTag: 'Installée',
} satisfies Record<keyof typeof zh, string>
