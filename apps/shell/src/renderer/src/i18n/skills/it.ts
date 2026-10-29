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
  intgSkillsErrDirUnreadable: 'impossibile leggere la cartella della competenza',
  intgSkillsErrDirSymlink:
    'la cartella della competenza è un link simbolico e l’importazione lo rifiuta',
  intgSkillsErrContainsSymlink:
    'la competenza contiene un link simbolico e l’importazione lo rifiuta',
  intgSkillsErrTooLarge: 'la competenza supera il limite di importazione di 10 MB',
  intgSkillsErrReadBackFailed: 'impossibile rileggere la competenza',
  intgSkillsErrMissingSkillMd: 'la cartella non contiene SKILL.md',
  intgSkillsErrInvalidFrontmatter: 'SKILL.md richiede name e description nel frontmatter',
  intgSkillsErrInvalidFolderName:
    'il nome della cartella non può essere usato come nome della competenza',
  intgSkillsErrAlreadyExists: 'esiste già una competenza con questo nome',
  intgSkillsErrFileUnreadable: 'impossibile leggere il file',
  intgSkillsErrInvalidFileName: 'il nome del file non può essere usato come nome della competenza',
  intgSkillsErrNotZip: 'il file non è un archivio zip',
  intgSkillsErrTooManyEntries: 'l’archivio supera il limite di importazione di {max} voci',
  intgSkillsErrUnsafeEntry: 'l’archivio contiene un nome di voce non sicuro: {name}',
  intgSkillsErrArchiveSymlink: 'l’archivio contiene un link simbolico e l’importazione lo rifiuta',
  intgSkillsErrArchiveMissingSkillMd:
    'l’archivio non contiene SKILL.md nella radice o in una singola cartella',
  intgSkillsErrInvalidArchiveName:
    'il nome dell’archivio non può essere usato come nome della competenza',
  intgSkillsErrUnknownSkill: 'competenza sconosciuta',
  intgSkillsErrUnknownTarget: 'destinazione della competenza sconosciuta',
} satisfies Record<keyof typeof zh, string>
