import type { zh } from './zh'

export const it = {
  webConflictTitle: 'Questa presentazione è stata modificata altrove',
  webConflictBody:
    'Le modifiche non sono ancora su UniWork e restano in questo browser finché non esci.',
  webConflictOverwrite: 'Sovrascrivi…',
  webConflictReload: 'Ricarica la più recente',
  webConflictNotSaved: 'la presentazione è stata modificata altrove',
  webDiscardTitle: 'Scartare le modifiche non salvate?',
  webDiscardBody:
    'Questa presentazione contiene modifiche non salvate. Aprendo un altro file andranno perse.',
  webDiscard: 'Scarta e apri',
  webCancel: 'Annulla',
  webOk: 'OK',
  webFatalTitle: 'Impossibile aprire la presentazione',
  webFatalBody: 'Impossibile caricare il file da UniWork. Chiudi questa scheda e riprova.',
  webNoHost: 'Questo editor funziona all’interno di UniWork. Apri la presentazione da UniWork.',
  webLegacyPpt:
    'Questo è un vecchio file .ppt e non può essere aperto nel browser. Salvalo prima come .pptx in PowerPoint.',
  webEncryptedPptx:
    'Questa presentazione è protetta da password e non può essere aperta nel browser.',
  webCommentAuthor: 'Utente',
  webExternalMedia:
    'I contenuti multimediali esterni collegati vengono riprodotti solo nell’app desktop.',
  webReadOnly: 'Questa presentazione è di sola lettura.',
  webSaveNetwork: 'Impossibile raggiungere UniWork. Controlla la connessione e riprova.',
  webSaveTimeout: 'Il salvataggio ha richiesto troppo tempo. Controlla la connessione e riprova.',
  webFullscreenHint: 'Fai clic o premi un tasto qualsiasi per passare a schermo intero',
} satisfies Record<keyof typeof zh, string>
