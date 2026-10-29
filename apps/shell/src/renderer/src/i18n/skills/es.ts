import type { zh } from './zh'

export const es = {
  setSecSkills: 'Habilidades',
  intgSkillsDesc:
    'UniWork Office solo usa habilidades de su propia carpeta. Importar una carpeta o un zip copia la habilidad completa; nada se ejecuta al importar.',
  intgSkillsEmpty: 'Aún no hay habilidades instaladas.',
  intgSkillsImportFolder: 'Importar carpeta…',
  intgSkillsImportZip: 'Importar paquete de habilidad (zip / .md)…',
  intgSkillsImportFolderTitle: 'Elegir carpeta de habilidad',
  intgSkillsImportZipTitle: 'Elegir zip o .md de habilidad',
  intgSkillsImportDone: '{name} importada',
  intgSkillsImportFailed: 'Error al importar: {reason}',
  intgSkillsRemove: 'Quitar',
  intgSkillsRemoveConfirm:
    '¿Quitar la habilidad "{name}"? Su carpeta se eliminará de UniWork Office.',
  intgSkillsRemoved: '{name} quitada',
  intgSkillsRead: 'Detalles',
  intgSkillsMine: 'Mis habilidades',
  intgSkillsRecommended: 'Recomendadas',
  intgSkillsCatOffice: 'Oficina',
  intgSkillsCatBusiness: 'Negocios',
  intgSkillsCatData: 'Datos',
  intgSkillsCatFinance: 'Finanzas',
  intgSkillsCatHr: 'RR. HH.',
  intgSkillsCatLegal: 'Legal',
  intgSkillsCatMarketing: 'Marketing',
  intgSkillsCatEducation: 'Educación',
  intgSkillsCatOther: 'Otros',
  intgSkillsInstall: 'Instalar',
  intgSkillsUpdate: 'Actualizar',
  intgSkillsInstalledTag: 'Instalada',
} satisfies Record<keyof typeof zh, string>
