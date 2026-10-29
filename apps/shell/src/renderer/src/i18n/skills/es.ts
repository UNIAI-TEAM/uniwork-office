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
  intgSkillsErrDirUnreadable: 'no se pudo leer la carpeta de la habilidad',
  intgSkillsErrDirSymlink:
    'la carpeta de la habilidad es un enlace simbólico y la importación los rechaza',
  intgSkillsErrContainsSymlink:
    'la habilidad contiene un enlace simbólico y la importación los rechaza',
  intgSkillsErrTooLarge: 'la habilidad supera el límite de importación de 10 MB',
  intgSkillsErrReadBackFailed: 'no se pudo volver a leer la habilidad',
  intgSkillsErrMissingSkillMd: 'la carpeta no tiene SKILL.md',
  intgSkillsErrInvalidFrontmatter: 'SKILL.md necesita name y description en el frontmatter',
  intgSkillsErrInvalidFolderName:
    'el nombre de la carpeta no se puede usar como nombre de habilidad',
  intgSkillsErrAlreadyExists: 'ya existe una habilidad con ese nombre',
  intgSkillsErrFileUnreadable: 'no se pudo leer el archivo',
  intgSkillsErrInvalidFileName: 'el nombre del archivo no se puede usar como nombre de habilidad',
  intgSkillsErrNotZip: 'el archivo no es un paquete zip',
  intgSkillsErrTooManyEntries: 'el archivo supera el límite de importación de {max} entradas',
  intgSkillsErrUnsafeEntry: 'el archivo tiene un nombre de entrada no seguro: {name}',
  intgSkillsErrArchiveSymlink:
    'el archivo contiene un enlace simbólico y la importación los rechaza',
  intgSkillsErrArchiveMissingSkillMd:
    'el archivo no tiene SKILL.md en la raíz ni dentro de una sola carpeta',
  intgSkillsErrInvalidArchiveName:
    'el nombre del archivo no se puede usar como nombre de habilidad',
  intgSkillsErrUnknownSkill: 'habilidad desconocida',
  intgSkillsErrUnknownTarget: 'destino de habilidad desconocido',
} satisfies Record<keyof typeof zh, string>
