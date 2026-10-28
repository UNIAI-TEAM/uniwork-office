import type { zh } from './zh'

export const it = {
  setSecSkills: 'Competenze',
  intgSkillsDesc:
    'UniWork Office usa solo le competenze nella propria cartella. Importare una cartella o uno zip copia l’intera competenza; nulla viene eseguito all’importazione.',
  intgSkillsEmpty: 'Nessuna competenza installata.',
  intgSkillsImportFolder: 'Importa cartella…',
  intgSkillsImportZip: 'Importa pacchetto competenza (zip / .md)…',
  intgSkillsImportFolderTitle: 'Scegli la cartella della competenza',
  intgSkillsImportZipTitle: 'Scegli lo zip o il .md della competenza',
  intgSkillsImportDone: '{name} importata',
  intgSkillsImportFailed: 'Importazione non riuscita: {reason}',
  intgSkillsRemove: 'Rimuovi',
  intgSkillsRemoveConfirm:
    'Rimuovere la competenza "{name}"? La sua cartella sarà eliminata da UniWork Office.',
  intgSkillsRemoved: '{name} rimossa',
  intgSkillsRead: 'Dettagli',
  intgSkillsMine: 'Le mie competenze',
  intgSkillsRecommended: 'Consigliate',
  intgSkillsCatOffice: 'Ufficio',
  intgSkillsCatBusiness: 'Business',
  intgSkillsCatData: 'Dati',
  intgSkillsCatFinance: 'Finanza',
  intgSkillsCatHr: 'Risorse umane',
  intgSkillsCatLegal: 'Legale',
  intgSkillsCatMarketing: 'Marketing',
  intgSkillsCatEducation: 'Istruzione',
  intgSkillsCatOther: 'Altro',
  intgSkillsInstall: 'Installa',
  intgSkillsUpdate: 'Aggiorna',
  intgSkillsInstalledTag: 'Installata',
} satisfies Record<keyof typeof zh, string>
