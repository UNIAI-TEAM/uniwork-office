import type { zh } from './zh'

export const pt = {
  setSecSkills: 'Habilidades',
  intgSkillsDesc:
    'O UniWork Office só usa habilidades da sua própria pasta. Importar uma pasta ou um zip copia a habilidade inteira; nada é executado na importação.',
  intgSkillsEmpty: 'Nenhuma habilidade instalada.',
  intgSkillsImportFolder: 'Importar pasta…',
  intgSkillsImportZip: 'Importar pacote de habilidade (zip / .md)…',
  intgSkillsImportFolderTitle: 'Escolher pasta da habilidade',
  intgSkillsImportZipTitle: 'Escolher zip ou .md da habilidade',
  intgSkillsImportDone: '{name} importada',
  intgSkillsImportFailed: 'Falha na importação: {reason}',
  intgSkillsRemove: 'Remover',
  intgSkillsRemoveConfirm:
    'Remover a habilidade "{name}"? A pasta dela será excluída do UniWork Office.',
  intgSkillsRemoved: '{name} removida',
  intgSkillsRead: 'Detalhes',
  intgSkillsMine: 'As minhas competências',
  intgSkillsRecommended: 'Recomendadas',
  intgSkillsCatOffice: 'Escritório',
  intgSkillsCatBusiness: 'Negócios',
  intgSkillsCatData: 'Dados',
  intgSkillsCatFinance: 'Finanças',
  intgSkillsCatHr: 'RH',
  intgSkillsCatLegal: 'Jurídico',
  intgSkillsCatMarketing: 'Marketing',
  intgSkillsCatEducation: 'Educação',
  intgSkillsCatOther: 'Outros',
  intgSkillsInstall: 'Instalar',
  intgSkillsUpdate: 'Atualizar',
  intgSkillsInstalledTag: 'Instalada',
} satisfies Record<keyof typeof zh, string>
